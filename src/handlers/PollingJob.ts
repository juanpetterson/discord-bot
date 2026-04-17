import fs from 'fs'
import https from 'https'
import { Client, EmbedBuilder, TextChannel } from 'discord.js'
import { DISCORD_TO_STEAM, fetchDotaNick, refreshAllDotaNicks } from './PlayerData'

const STATE_FILE = './src/assets/data/polling-state.json'
const OPENDOTA_API = 'https://api.opendota.com/api'
const POLL_INTERVAL_MS = 30 * 60 * 1000       // 30 minutes
const NICK_REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000  // 24 hours

// ── State ──────────────────────────────────────────────────────────────────

interface PollingState {
  /** Discord channel ID where the last !resume* command was used */
  resumeChannelId: string | null
  /** steamId → array of known match IDs from the previous poll */
  seenMatchIds: Record<string, number[]>
  /** Unix ms timestamp of the last forced nickname refresh */
  lastNickRefresh: number
}

function loadState(): PollingState {
  try {
    if (fs.existsSync(STATE_FILE)) {
      const raw = fs.readFileSync(STATE_FILE, 'utf-8')
      return JSON.parse(raw) as PollingState
    }
  } catch (err) {
    console.warn('[PollingJob] Could not load state file, starting fresh:', err)
  }
  return { resumeChannelId: null, seenMatchIds: {}, lastNickRefresh: 0 }
}

function saveState(state: PollingState): void {
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2))
  } catch (err) {
    console.error('[PollingJob] Failed to save state:', err)
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────

function httpsGet(url: string): Promise<any> {
  return new Promise((resolve) => {
    https
      .get(url, { headers: { 'User-Agent': 'discord-bot/1.0' } }, (res) => {
        let body = ''
        res.on('data', (chunk: any) => (body += chunk))
        res.on('end', () => {
          try { resolve(JSON.parse(body)) } catch { resolve(null) }
        })
      })
      .on('error', () => resolve(null))
  })
}

// Local hero map cache (loaded once)
const heroMap: Record<number, string> = {}

async function ensureHeroMap(): Promise<void> {
  if (Object.keys(heroMap).length > 0) return
  const heroes = await httpsGet(`${OPENDOTA_API}/heroes`)
  if (Array.isArray(heroes)) {
    for (const h of heroes) heroMap[h.id] = h.localized_name
  }
}

function heroName(id: number): string {
  return heroMap[id] || `Hero #${id}`
}

// ── Recent match shape (subset we care about) ─────────────────────────────

interface RecentMatch {
  match_id: number
  hero_id: number
  kills: number
  deaths: number
  assists: number
  player_slot: number
  radiant_win: boolean
  game_mode: number
  start_time: number
}

// ── PollingJob ─────────────────────────────────────────────────────────────

export class PollingJob {
  private static state: PollingState = {
    resumeChannelId: null,
    seenMatchIds: {},
    lastNickRefresh: 0,
  }

  /**
   * Start the polling job.
   * Call this inside client.once('clientReady', ...).
   */
  static start(client: Client): void {
    PollingJob.state = loadState()

    console.log('[PollingJob] Started — resumeChannel:', PollingJob.state.resumeChannelId ?? '(none)')
    console.log('[PollingJob] Tracked players:', Object.keys(PollingJob.state.seenMatchIds).length)
    console.log('[PollingJob] State file path (resolved):', require('path').resolve(STATE_FILE))
    console.log('[PollingJob] State file exists:', fs.existsSync(STATE_FILE))
    console.log('[PollingJob] DISCORD_TO_STEAM entries:', Object.keys(DISCORD_TO_STEAM).length)

    // Seed match IDs for any newly added players (without posting) after 10 s
    setTimeout(() => PollingJob.initializeNewPlayers(), 10_000)

    // Every 30 min: check for new matches
    setInterval(() => PollingJob.checkNewMatches(client), POLL_INTERVAL_MS)

    // Every 24 h: force-refresh all Dota nicknames
    setInterval(() => PollingJob.runNickRefresh(), NICK_REFRESH_INTERVAL_MS)

    // If last nick refresh was > 24 h ago, do one right after startup
    if (Date.now() - PollingJob.state.lastNickRefresh > NICK_REFRESH_INTERVAL_MS) {
      setTimeout(() => PollingJob.runNickRefresh(), 20_000)
    }
  }

  /**
   * Call this whenever a !resume* command or button is used so we always know
   * the right channel to post automated notifications to.
   */
  static setResumeChannel(channelId: string): void {
    console.log(`[PollingJob] setResumeChannel called with: ${channelId} (current: ${PollingJob.state.resumeChannelId ?? '(null)'})`)
    if (PollingJob.state.resumeChannelId === channelId) return
    PollingJob.state.resumeChannelId = channelId
    saveState(PollingJob.state)
    console.log(`[PollingJob] Resume channel updated and saved: ${channelId}`)
  }

  // ── Private ──────────────────────────────────────────────────────────────

  /**
   * Silently fetch and store the current match IDs for any player that has no
   * entry in seenMatchIds yet (e.g. newly added to DISCORD_TO_STEAM).
   * This prevents flooding the channel with old matches on first run.
   */
  private static async initializeNewPlayers(): Promise<void> {
    let changed = false

    for (const [discordName, steamId] of Object.entries(DISCORD_TO_STEAM)) {
      if (PollingJob.state.seenMatchIds[steamId] !== undefined) continue

      try {
        const recent: RecentMatch[] = await httpsGet(
          `${OPENDOTA_API}/players/${steamId}/recentMatches`
        )
        if (Array.isArray(recent) && recent.length > 0) {
          PollingJob.state.seenMatchIds[steamId] = recent.map((m) => m.match_id)
          changed = true
          console.log(
            `[PollingJob] Initialized ${recent.length} match IDs for ${discordName} (${steamId})`
          )
        }
      } catch (err) {
        console.warn(`[PollingJob] Failed to initialize matches for ${discordName}:`, err)
      }
    }

    if (changed) saveState(PollingJob.state)
  }

  /**
   * Fetch recent matches for all mapped players, detect new match IDs compared
   * to the last poll, and post a summary embed to the resume channel if any
   * new matches are found.
   */
  private static async checkNewMatches(client: Client): Promise<void> {
    console.log('[PollingJob] Checking for new matches at', new Date().toISOString())
    console.log('[PollingJob] Current resumeChannelId:', PollingJob.state.resumeChannelId ?? '(null)')
    console.log('[PollingJob] Tracked steam IDs:', Object.keys(PollingJob.state.seenMatchIds).join(', ') || '(none)')

    if (!PollingJob.state.resumeChannelId) {
      console.log('[PollingJob] No resume channel configured — skipping. Use a !resume command first to set it.')
      return
    }

    try {
      await ensureHeroMap()

      interface NewMatchInfo {
        hero: string
        kills: number
        deaths: number
        assists: number
        won: boolean
        isTurbo: boolean
        matchId: number
      }

      const newMatchesByPlayer: Array<{ name: string; matches: NewMatchInfo[] }> = []

      for (const [discordName, steamId] of Object.entries(DISCORD_TO_STEAM)) {
        try {
          const recent: RecentMatch[] = await httpsGet(
            `${OPENDOTA_API}/players/${steamId}/recentMatches`
          )
          if (!Array.isArray(recent) || recent.length === 0) continue

          const knownIds = new Set<number>(PollingJob.state.seenMatchIds[steamId] ?? [])
          const newMatches = recent.filter((m) => !knownIds.has(m.match_id))

          console.log(`[PollingJob] ${discordName} (${steamId}): ${recent.length} recent, ${knownIds.size} known, ${newMatches.length} new`)

          // Always update the seen IDs to the latest snapshot
          PollingJob.state.seenMatchIds[steamId] = recent.map((m) => m.match_id)

          if (newMatches.length === 0) continue

          const playerName = await fetchDotaNick(steamId, discordName)

          const matchInfos: NewMatchInfo[] = newMatches.map((m) => {
            const isRadiant = m.player_slot < 128
            const won = (isRadiant && m.radiant_win) || (!isRadiant && !m.radiant_win)
            return {
              hero: heroName(m.hero_id),
              kills: m.kills,
              deaths: m.deaths,
              assists: m.assists,
              won,
              isTurbo: m.game_mode === 23,
              matchId: m.match_id,
            }
          })

          newMatchesByPlayer.push({ name: playerName, matches: matchInfos })
        } catch (err) {
          console.warn(`[PollingJob] Failed to check matches for ${discordName}:`, err)
        }
      }

      saveState(PollingJob.state)

      if (newMatchesByPlayer.length === 0) {
        console.log('[PollingJob] No new matches found')
        return
      }

      // Build embed
      const lines = newMatchesByPlayer.map(({ name, matches }) => {
        const wins = matches.filter((m) => m.won).length
        const losses = matches.length - wins
        const icon = wins > losses ? '🟢' : losses > wins ? '🔴' : '🟡'

        const matchLines = matches
          .map((m) => {
            const result = m.won ? '✅' : '❌'
            const mode = m.isTurbo ? ' *(Turbo)*' : ''
            return `  ${result} **${m.hero}**${mode} — ${m.kills}/${m.deaths}/${m.assists}`
          })
          .join('\n')

        const plural = matches.length !== 1 ? 'es' : ''
        return `${icon} **${name}** — ${matches.length} new match${plural} (${wins}W / ${losses}L)\n${matchLines}`
      })

      const embed = new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle('🎮 New Dota 2 Matches Detected')
        .setDescription(lines.join('\n\n'))
        .setTimestamp()
        .setFooter({ text: 'Automatic match tracker • checks every 30 min' })

      // Post to the resume channel
      let channel = client.channels.cache.get(
        PollingJob.state.resumeChannelId
      ) as TextChannel | undefined

      if (!channel) {
        console.warn(`[PollingJob] Channel ${PollingJob.state.resumeChannelId} not in cache — trying to fetch...`)
        try {
          const fetched = await client.channels.fetch(PollingJob.state.resumeChannelId)
          if (fetched && fetched.isTextBased()) {
            channel = fetched as TextChannel
          } else {
            console.error(`[PollingJob] Could not fetch channel ${PollingJob.state.resumeChannelId} — skipping`)
            return
          }
        } catch (fetchErr) {
          console.error(`[PollingJob] Failed to fetch channel ${PollingJob.state.resumeChannelId}:`, fetchErr)
          return
        }
      }

      await channel.send({ embeds: [embed] })
      console.log(`[PollingJob] Posted match notification for ${newMatchesByPlayer.length} player(s)`)
    } catch (err) {
      console.error('[PollingJob] Unexpected error during match check:', err)
    }
  }

  /** Force-refresh all Dota nicknames and persist the timestamp. */
  private static async runNickRefresh(): Promise<void> {
    const lastRefreshAgo = PollingJob.state.lastNickRefresh
      ? `${((Date.now() - PollingJob.state.lastNickRefresh) / 3600000).toFixed(1)}h ago`
      : 'never'
    console.log(`[PollingJob] Starting nickname refresh (last refresh: ${lastRefreshAgo})`)
    try {
      await refreshAllDotaNicks()
      PollingJob.state.lastNickRefresh = Date.now()
      saveState(PollingJob.state)
      console.log(`[PollingJob] Nickname refresh complete — next in 24h. State saved with lastNickRefresh=${PollingJob.state.lastNickRefresh}`)
    } catch (err) {
      console.error('[PollingJob] Error refreshing nicknames:', err)
    }
  }
}
