import { Message, EmbedBuilder } from 'discord.js'
import fs from 'fs'
import https from 'https'

const BETS_FILE = './src/assets/data/bets.json'

// ─── Steam ↔ Discord user map ─────────────────────────────────────────────
// Key: Discord user ID | Value: Steam32 account ID (not 64-bit)
// Populate with real IDs later.
export const DISCORD_TO_STEAM: Record<string, string> = {
  // 'DISCORD_USER_ID': 'STEAM_ACCOUNT_ID_32',
  // Example (fake):
  // '123456789012345678': '12345678',
  'carlesso2154': '137839730',
  'jacksonmajolo': '117092439',
  'gbonassina': '109723713',
  'cristiano.bonassina': '102605845',
  'eradim': '18354196',
  'dedableo': '1290315073',
  'juanpetterson.': '89756583',
  'arlovas.': '65463725',
  'fermino.': '89331213',
  'matheusagnes': '18344803',
  '.jogador.' : '96204401',
  'j14070' : '105610618',
  'xgrahl' : '51878986'
}

// Dota 2 nick cache — keyed by steamId
const DOTA_NICKS_FILE = './src/assets/data/dota-nicks.json'
const DOTA_NICK_TTL_MS = 6 * 60 * 60 * 1000 // 6 hours

interface DotaNickEntry {
  nick: string
  fetchedAt: number // unix ms
}

function loadDotaNicksCache(): Record<string, DotaNickEntry> {
  try {
    if (!fs.existsSync(DOTA_NICKS_FILE)) return {}
    return JSON.parse(fs.readFileSync(DOTA_NICKS_FILE, 'utf-8'))
  } catch {
    return {}
  }
}

function saveDotaNicksCache(cache: Record<string, DotaNickEntry>) {
  fs.writeFileSync(DOTA_NICKS_FILE, JSON.stringify(cache, null, 2))
}

function fetchPlayerProfile(steamId: string): Promise<any> {
  return new Promise((resolve) => {
    const url = `https://api.opendota.com/api/players/${steamId}`
    https
      .get(url, (res) => {
        let body = ''
        res.on('data', (chunk) => (body += chunk))
        res.on('end', () => {
          try { resolve(JSON.parse(body)) } catch { resolve(null) }
        })
      })
      .on('error', () => resolve(null))
  })
}

/** Returns the Dota 2 persona name for a steam32 account id, using a 6h cache. */
async function fetchDotaNick(steamId: string | undefined, fallback: string): Promise<string> {
  if (!steamId) return fallback

  const cache = loadDotaNicksCache()
  const entry = cache[steamId]

  if (entry && Date.now() - entry.fetchedAt < DOTA_NICK_TTL_MS) {
    return entry.nick
  }

  try {
    const profile = await fetchPlayerProfile(steamId)
    const nick: string = profile?.profile?.personaname || fallback
    cache[steamId] = { nick, fetchedAt: Date.now() }
    saveDotaNicksCache(cache)
    console.log(`[DotaNick] Fetched nick for steamId ${steamId}: ${nick}`)
    return nick
  } catch (err) {
    console.warn(`[DotaNick] Failed to fetch nick for steamId ${steamId}:`, err)
    return entry?.nick ?? fallback
  }
}



// ─── Types ────────────────────────────────────────────────────────────────

interface PlayerStats {
  points: number
  wins: number
  losses: number
  name: string
}

interface ActiveBet {
  bettorId: string
  bettorName: string
  /** Server display name of the bettor */
  bettorDisplayName: string
  /** Discord ID of the player being bet on */
  targetDiscordId: string
  targetName: string
  /** Dota 2 in-game nickname of the target */
  targetDotaNick: string
  /** 'win' | 'lose' */
  prediction: 'win' | 'lose'
  timestamp: string
}

interface BetsData {
  leaderboard: Record<string, PlayerStats>
  activeBets: ActiveBet[]
}

// ─── Persistence ──────────────────────────────────────────────────────────

function loadBets(): BetsData {
  try {
    if (!fs.existsSync(BETS_FILE)) {
      const initial: BetsData = { leaderboard: {}, activeBets: [] }
      fs.writeFileSync(BETS_FILE, JSON.stringify(initial, null, 2))
      return initial
    }
    return JSON.parse(fs.readFileSync(BETS_FILE, 'utf-8'))
  } catch {
    return { leaderboard: {}, activeBets: [] }
  }
}

function saveBets(data: BetsData) {
  fs.writeFileSync(BETS_FILE, JSON.stringify(data, null, 2))
}

function ensurePlayer(data: BetsData, id: string, name?: string): PlayerStats {
  if (!data.leaderboard[id]) {
    data.leaderboard[id] = { points: 1000, wins: 0, losses: 0, name: name || id }
  } else if (name) {
    data.leaderboard[id].name = name
  }
  return data.leaderboard[id]
}

// ─── OpenDota helpers ─────────────────────────────────────────────────────

function fetchMatch(matchId: string): Promise<any> {
  return new Promise((resolve) => {
    const url = `https://api.opendota.com/api/matches/${matchId}`
    https
      .get(url, (res) => {
        let body = ''
        res.on('data', (chunk) => (body += chunk))
        res.on('end', () => {
          try { resolve(JSON.parse(body)) } catch { resolve(null) }
        })
      })
      .on('error', () => resolve(null))
  })
}



// ─── BetHandler ───────────────────────────────────────────────────────────

export class BetHandler {
  /**
   * !bet @player nós|nos|eles
   *
   * nós/nos = you think the player wins
   * eles    = you think the player loses
   */
  static async placeBet(message: Message, args: string) {
    const parts = args.trim().split(/\s+/)

    if (parts.length < 2) {
      message.reply(
        'Usage: `!bet @player nós` or `!bet @player eles`\n' +
          '> **nós** / **nos** → player **wins**\n' +
          '> **eles** → player **loses**'
      )
      return
    }

    const mention = message.mentions.users.first()
    if (!mention) {
      message.reply('You must mention a player. Example: `!bet @ruro nós`')
      return
    }

    const rawPrediction = parts[parts.length - 1].toLowerCase()
    let prediction: 'win' | 'lose'

    if (rawPrediction === 'nós' || rawPrediction === 'nos') {
      prediction = 'win'
    } else if (rawPrediction === 'eles') {
      prediction = 'lose'
    } else {
      message.reply('Prediction must be **nós** (win) or **eles** (lose).')
      return
    }

    const steamId = DISCORD_TO_STEAM[mention.username]
    const targetDotaNick = await fetchDotaNick(steamId, mention.username)

    const data = loadBets()
    const bettorDisplayName = message.member?.displayName ?? message.author.username
    ensurePlayer(data, message.author.id, bettorDisplayName)

    // One active bet per bettor per target
    const existingBet = data.activeBets.find(
      (b) => b.bettorId === message.author.id && b.targetName === mention.username
    )
    if (existingBet) {
      message.reply(
        `You already have an active bet on **${existingBet.targetDotaNick}** (${existingBet.prediction}). Use \`!cancelbet @${mention.username}\` first.`
      )
      return
    }

    ensurePlayer(data, mention.id, mention.username)

    data.activeBets.push({
      bettorId: message.author.id,
      bettorName: message.author.username,
      bettorDisplayName,
      targetDiscordId: mention.id,
      targetName: mention.username,
      targetDotaNick,
      prediction,
      timestamp: new Date().toISOString(),
    })

    saveBets(data)

    const predLabel = prediction === 'win' ? '🏆 WIN' : '💀 LOSE'
    const embed = new EmbedBuilder()
      .setColor(prediction === 'win' ? 0x00cc66 : 0xff3333)
      .setTitle('🎰 Bet Placed!')
      .setDescription(`**${bettorDisplayName}** bets that **${targetDotaNick}** will **${predLabel}**!`)
      .setFooter({ text: `!cancelbet @${mention.username} to cancel | !bets to see active bets` })

    message.channel.send({ embeds: [embed] })
  }

  /**
   * !betwin <matchId>
   * Resolves all active bets using OpenDota match data.
   */
  static async resolveByMatch(message: Message, matchId: string) {
    if (!matchId || isNaN(Number(matchId))) {
      message.reply('Usage: `!betwin <matchId>`')
      return
    }

    await message.channel.send(`🔍 Fetching match **${matchId}** from OpenDota...`)

    const match = await fetchMatch(matchId)
    if (!match || !match.players) {
      message.reply(`❌ Could not fetch match **${matchId}**. Make sure it's a valid match ID.`)
      return
    }

    const data = loadBets()
    if (data.activeBets.length === 0) {
      message.reply('No active bets to resolve.')
      return
    }

    const results: string[] = []

    for (const bet of [...data.activeBets]) {
      const steamId = DISCORD_TO_STEAM[bet.targetName]
      if (!steamId) {
        console.log(`[BetHandler] No Steam ID for ${bet.targetName} — cannot resolve`)
        results.push(`⚠️ **${bet.bettorName}** → ${bet.targetName}: no Steam ID mapped, skipped.`)
        continue
      }

      const accountId32 = parseInt(steamId, 10)
      const player = match.players.find((p: any) => p.account_id === accountId32)

      if (!player) {
        console.log(`[BetHandler] ${bet.targetName} (steam32: ${steamId}) not found in match ${matchId}`)
        results.push(`⚠️ **${bet.bettorName}** → ${bet.targetName}: not found in this match.`)
        continue
      }

      const isRadiant = player.player_slot < 128
      const didWin: boolean = isRadiant ? match.radiant_win : !match.radiant_win
      const betWon = (bet.prediction === 'win' && didWin) || (bet.prediction === 'lose' && !didWin)

      const bettorStats = ensurePlayer(data, bet.bettorId, bet.bettorName)

      if (betWon) {
        bettorStats.points += 100
        bettorStats.wins++
        results.push(
          `✅ **${bet.bettorDisplayName ?? bet.bettorName}** WON! (+100 pts) — bet **${bet.prediction === 'win' ? '🏆 WIN' : '💀 LOSE'}** on **${bet.targetDotaNick ?? bet.targetName}** — Balance: **${bettorStats.points}**`
        )
      } else {
        bettorStats.points = Math.max(0, bettorStats.points - 50)
        bettorStats.losses++
        results.push(
          `❌ **${bet.bettorDisplayName ?? bet.bettorName}** LOST! (-50 pts) — bet **${bet.prediction === 'win' ? '🏆 WIN' : '💀 LOSE'}** on **${bet.targetDotaNick ?? bet.targetName}** — Balance: **${bettorStats.points}**`
        )
      }

      data.activeBets = data.activeBets.filter((b) => b.bettorId !== bet.bettorId)
    }

    saveBets(data)

    const embed = new EmbedBuilder()
      .setColor(0xffd700)
      .setTitle(`🏁 Match ${matchId} — Bet Results`)
      .setDescription(results.join('\n') || 'No bets were resolved.')
      .setFooter({ text: `Match ID: ${matchId}` })

    message.channel.send({ embeds: [embed] })
  }

  /**
   * Cancel a specific bet: !cancelbet @target
   */
  static async cancelBet(message: Message) {
    const mention = message.mentions.users.first()
    if (!mention) {
      message.reply('Usage: `!cancelbet @player` — mention the player you bet on.')
      return
    }

    const data = loadBets()
    const idx = data.activeBets.findIndex(
      (b) => b.bettorId === message.author.id && b.targetName === mention.username
    )

    if (idx === -1) {
      const nick = await fetchDotaNick(DISCORD_TO_STEAM[mention.username], mention.username)
      message.reply(`You don't have an active bet on **${nick}**.`)
      return
    }

    const bet = data.activeBets.splice(idx, 1)[0]
    saveBets(data)

    message.reply(`🔄 Bet cancelled. You had bet **${bet.prediction === 'win' ? '🏆 WIN' : '💀 LOSE'}** on **${bet.targetDotaNick}**.`)
  }

  /**
   * Show all active bets: !bets
   */
  static showActiveBets(message: Message) {
    const data = loadBets()

    if (data.activeBets.length === 0) {
      message.reply('No active bets! Use `!bet @player nós` or `!bet @player eles`')
      return
    }

    const betsText = data.activeBets
      .map(
        (bet, i) =>
          `${i + 1}. **${bet.bettorDisplayName ?? bet.bettorName}** → **${bet.targetDotaNick ?? bet.targetName}**: **${bet.prediction === 'win' ? '🏆 WIN' : '💀 LOSE'}**`
      )
      .join('\n')

    const embed = new EmbedBuilder()
      .setColor(0xffa500)
      .setTitle('🎰 Active Bets')
      .setDescription(betsText)
      .setFooter({ text: '!betwin <matchId> to resolve | !cancelbet @player to cancel' })

    message.channel.send({ embeds: [embed] })
  }

  /**
   * Show leaderboard: !leaderboard
   */
  static showLeaderboard(message: Message) {
    const data = loadBets()
    const entries = Object.entries(data.leaderboard)

    if (entries.length === 0) {
      message.reply('No bets have been placed yet!')
      return
    }

    const sorted = entries.sort(([, a], [, b]) => b.points - a.points)
    const medals = ['🥇', '🥈', '🥉']

    const leaderboardText = sorted
      .slice(0, 10)
      .map(([, stats], index) => {
        const medal = medals[index] || `**${index + 1}.**`
        return `${medal} ${stats.name} — **${stats.points}** pts (${stats.wins}W/${stats.losses}L)`
      })
      .join('\n')

    const embed = new EmbedBuilder()
      .setColor(0xffd700)
      .setTitle('🏆 Betting Leaderboard')
      .setDescription(leaderboardText)
      .setFooter({ text: 'Win: +100 pts | Lose: -50 pts | Everyone starts at 1000' })

    message.channel.send({ embeds: [embed] })
  }

  /**
   * Check your own balance: !balance
   */
  static checkBalance(message: Message) {
    const data = loadBets()
    const player = ensurePlayer(data, message.author.id, message.author.username)
    saveBets(data)

    message.reply(
      `💰 **${message.author.username}** — Balance: **${player.points}** pts | ${player.wins}W / ${player.losses}L`
    )
  }
}
