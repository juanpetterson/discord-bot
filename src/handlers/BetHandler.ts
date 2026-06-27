import { Message, EmbedBuilder } from 'discord.js'
import fs from 'fs'
import path from 'path'
import https from 'https'
import { t, LANG } from '../i18n'
import { DISCORD_TO_STEAM, fetchDotaNick, getSteamIdsFor, toAccountId } from './PlayerData'

const BETS_FILE = './src/assets/data/bets.json'


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

/** A player covered by an open betting round (one game, shared outcome). */
interface RoundPlayer {
  name: string        // Discord username
  dotaNick: string
  steamIds: string[]  // Steam32 accounts
}

/** A single wager placed on the open round. */
interface RoundBet {
  bettorId: string
  bettorName: string
  bettorDisplayName: string
  prediction: 'win' | 'lose'  // win = the group's team wins
  timestamp: string
}

/**
 * A manually-opened betting round (via !betstart). Groups one or more mapped
 * players that are in the SAME game, so a single round resolves all wagers at
 * once instead of one bet per player.
 */
interface BetRound {
  players: RoundPlayer[]
  openedById: string
  openedByName: string
  openedAt: string
  bets: RoundBet[]
  matchId?: string
}

interface BetsData {
  leaderboard: Record<string, PlayerStats>
  activeBets: ActiveBet[]
  /** The single currently-open round, or null/absent if none. */
  round?: BetRound | null
}

// ─── Persistence ──────────────────────────────────────────────────────────

function loadBets(): BetsData {
  try {
    if (!fs.existsSync(BETS_FILE)) {
      const initial: BetsData = { leaderboard: {}, activeBets: [], round: null }
      fs.writeFileSync(BETS_FILE, JSON.stringify(initial, null, 2))
      return initial
    }
    const parsed = JSON.parse(fs.readFileSync(BETS_FILE, 'utf-8'))
    // Normalize so older files (without `round`) load cleanly.
    return {
      leaderboard: parsed.leaderboard ?? {},
      activeBets: parsed.activeBets ?? [],
      round: parsed.round ?? null,
    }
  } catch {
    return { leaderboard: {}, activeBets: [], round: null }
  }
}

function saveBets(data: BetsData) {
  const dir = path.dirname(BETS_FILE)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
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

/** Short bilingual string helper for round messages (rest of file uses i18n t()). */
const msg = (pt: string, en: string) => (LANG === 'pt-br' ? pt : en)

/** Parses a prediction token: nós/nos = win, eles = lose. */
function parsePrediction(raw: string): 'win' | 'lose' | null {
  if (raw === 'nós' || raw === 'nos') return 'win'
  if (raw === 'eles') return 'lose'
  return null
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

interface RecentMatch {
  match_id: number
  start_time: number
}

function fetchRecentMatches(accountId: string): Promise<RecentMatch[] | null> {
  return new Promise((resolve) => {
    const url = `https://api.opendota.com/api/players/${accountId}/recentMatches`
    https
      .get(url, (res) => {
        let body = ''
        res.on('data', (chunk) => (body += chunk))
        res.on('end', () => {
          try {
            const parsed = JSON.parse(body)
            resolve(Array.isArray(parsed) ? parsed : null)
          } catch { resolve(null) }
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
    const parts = args.trim().split(/\s+/).filter(Boolean)
    const mention = message.mentions.users.first()

    // No @mention → wager on the currently open round (!bet nós|eles)
    if (!mention) {
      const roundPrediction = parsePrediction((parts[parts.length - 1] ?? '').toLowerCase())
      if (!roundPrediction) {
        message.reply(msg(
          'Uso: `!bet nós|eles` (na rodada aberta) ou `!bet @jogador nós|eles`.',
          'Usage: `!bet nós|eles` (open round) or `!bet @player nós|eles`.'
        ))
        return
      }
      return BetHandler.placeRoundBet(message, roundPrediction)
    }

    if (parts.length < 2) {
      message.reply(t('bet.usage'))
      return
    }

    const prediction = parsePrediction(parts[parts.length - 1].toLowerCase())
    if (!prediction) {
      message.reply(t('bet.invalidChoice'))
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
        t('bet.alreadyBetOn', { nick: existingBet.targetDotaNick, pred: existingBet.prediction, user: mention.username })
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

    try {
      saveBets(data)
    } catch (err) {
      console.error('[BetHandler] Failed to persist bet:', err)
      message.reply(
        LANG === 'pt-br'
          ? '⚠️ Não consegui salvar a aposta (erro de armazenamento). Tenta de novo em instantes.'
          : '⚠️ Could not save the bet (storage error). Please try again shortly.'
      )
      return
    }

    const predLabel = prediction === 'win' ? t('bet.predWin') : t('bet.predLose')
    const embed = new EmbedBuilder()
      .setColor(prediction === 'win' ? 0x00cc66 : 0xff3333)
      .setTitle(t('bet.betTitle'))
      .setDescription(t('bet.betDesc', { bettor: bettorDisplayName, pred: predLabel, target: targetDotaNick }))
      .setFooter({ text: t('bet.betFooter', { user: mention.username }) })

    message.channel.send({ embeds: [embed] })
  }

  // ─── Betting rounds (!betstart) ─────────────────────────────────────────

  /**
   * !betstart @j1 @j2 ...
   * Opens a single betting round for one or more mapped players in the SAME
   * game (shared outcome). One round at a time; bettors then use `!bet nós|eles`.
   */
  static async placeBetStart(message: Message) {
    const mentions = [...message.mentions.users.values()].filter((u) => !u.bot)
    if (mentions.length === 0) {
      message.reply(msg(
        'Uso: `!betstart @jogador [@jogador2 ...]` — abre a aposta pros jogadores que estão no mesmo jogo.',
        'Usage: `!betstart @player [@player2 ...]` — opens betting for players in the same game.'
      ))
      return
    }

    const data = loadBets()
    if (data.round) {
      const openNicks = data.round.players.map((p) => p.dotaNick).join(', ')
      message.reply(msg(
        `⚠️ Já tem uma aposta aberta (${openNicks}). Use \`!betcancelround\` ou espere ela resolver.`,
        `⚠️ A round is already open (${openNicks}). Use \`!betcancelround\` or wait for it to resolve.`
      ))
      return
    }

    const players: RoundPlayer[] = []
    const skipped: string[] = []
    for (const user of mentions) {
      const steamIds = getSteamIdsFor(user.username)
      if (steamIds.length === 0) { skipped.push(user.username); continue }
      const dotaNick = await fetchDotaNick(steamIds[0], user.username)
      players.push({ name: user.username, dotaNick, steamIds })
    }

    if (players.length === 0) {
      message.reply(msg(
        '❌ Nenhum dos jogadores mencionados tem Steam mapeado.',
        '❌ None of the mentioned players have a mapped Steam account.'
      ))
      return
    }

    data.round = {
      players,
      openedById: message.author.id,
      openedByName: message.member?.displayName ?? message.author.username,
      openedAt: new Date().toISOString(),
      bets: [],
    }

    try {
      saveBets(data)
    } catch (err) {
      console.error('[BetHandler] Failed to open round:', err)
      message.reply(msg('⚠️ Erro ao abrir a aposta, tenta de novo.', '⚠️ Failed to open the round, try again.'))
      return
    }

    const nicks = players.map((p) => `**${p.dotaNick}**`).join(', ')
    const note = skipped.length
      ? msg(`\n_(ignorados, sem Steam: ${skipped.join(', ')})_`, `\n_(skipped, no Steam: ${skipped.join(', ')})_`)
      : ''
    const embed = new EmbedBuilder()
      .setColor(0x00ff99)
      .setTitle(msg('🎲 Apostas abertas!', '🎲 Betting is open!'))
      .setDescription(msg(
        `Jogo de ${nicks}.\nAposte com \`!bet nós\` (eles vencem) ou \`!bet eles\` (perdem).${note}`,
        `Game of ${nicks}.\nBet with \`!bet nós\` (they win) or \`!bet eles\` (they lose).${note}`
      ))
      .setFooter({ text: msg('Resolve sozinho quando a partida terminar.', 'Resolves automatically when the match ends.') })
      .setTimestamp()
    message.channel.send({ embeds: [embed] })
  }

  /** Places a wager on the currently open round (from `!bet nós|eles`). */
  static async placeRoundBet(message: Message, prediction: 'win' | 'lose') {
    const data = loadBets()
    if (!data.round) {
      message.reply(msg(
        'Não tem aposta aberta. Abra uma com `!betstart @jogador`.',
        'No open round. Open one with `!betstart @player`.'
      ))
      return
    }

    const bettorDisplayName = message.member?.displayName ?? message.author.username
    ensurePlayer(data, message.author.id, bettorDisplayName)

    const existing = data.round.bets.find((b) => b.bettorId === message.author.id)
    if (existing) {
      message.reply(msg(
        `Você já apostou **${existing.prediction === 'win' ? 'nós' : 'eles'}** nessa rodada.`,
        `You already bet **${existing.prediction === 'win' ? 'win' : 'lose'}** on this round.`
      ))
      return
    }

    data.round.bets.push({
      bettorId: message.author.id,
      bettorName: message.author.username,
      bettorDisplayName,
      prediction,
      timestamp: new Date().toISOString(),
    })

    try {
      saveBets(data)
    } catch (err) {
      console.error('[BetHandler] Failed to persist round bet:', err)
      message.reply(msg('⚠️ Erro ao salvar a aposta, tenta de novo.', '⚠️ Failed to save the bet, try again.'))
      return
    }

    const nicks = data.round.players.map((p) => p.dotaNick).join(', ')
    const predLabel = prediction === 'win' ? msg('NÓS (vitória)', 'WIN') : msg('ELES (derrota)', 'LOSS')
    message.reply(msg(
      `✅ Aposta registrada: **${predLabel}** no jogo de ${nicks}.`,
      `✅ Bet placed: **${predLabel}** on ${nicks}'s game.`
    ))
  }

  /** !betround — shows the open round and its wagers. */
  static async roundStatus(message: Message) {
    const data = loadBets()
    if (!data.round) {
      message.reply(msg('Não tem aposta aberta.', 'No open round.'))
      return
    }
    const nicks = data.round.players.map((p) => p.dotaNick).join(', ')
    const betLines = data.round.bets.length
      ? data.round.bets.map((b) => `• ${b.bettorDisplayName}: ${b.prediction === 'win' ? 'nós' : 'eles'}`).join('\n')
      : msg('_(sem apostas ainda)_', '_(no bets yet)_')
    const embed = new EmbedBuilder()
      .setColor(0x00ff99)
      .setTitle(msg('🎲 Aposta aberta', '🎲 Open round'))
      .setDescription(`${msg('Jogo de', 'Game of')} **${nicks}**\n\n${betLines}`)
    message.channel.send({ embeds: [embed] })
  }

  /** !betcancelround — cancels the open round without paying out. */
  static async cancelRound(message: Message) {
    const data = loadBets()
    if (!data.round) {
      message.reply(msg('Não tem aposta aberta.', 'No open round.'))
      return
    }
    data.round = null
    saveBets(data)
    message.reply(msg('🚫 Aposta cancelada (ninguém ganha nem perde pontos).', '🚫 Round cancelled (no points won or lost).'))
  }

  /**
   * Auto-resolves the open round: finds the match its players are in (started
   * around when the round opened), determines the group's result and pays out.
   * Posts a result embed via `postEmbed`. No-op if no round or no match yet.
   */
  static async autoResolveRound(postEmbed: (embed: EmbedBuilder) => Promise<void>) {
    const data = loadBets()
    const round = data.round
    if (!round) return

    const openedAt = Math.floor(new Date(round.openedAt).getTime() / 1000)
    const steamIds = [...new Set(round.players.reduce<string[]>((acc, p) => acc.concat(p.steamIds), []))]

    // Find the finished match closest to when the round opened (match may start
    // up to ~30 min after !betstart, or the round may be opened a bit late).
    let best: { matchId: string; diff: number } | null = null
    for (const sid of steamIds) {
      const recent = await fetchRecentMatches(toAccountId(sid))
      if (!recent) continue
      for (const m of recent) {
        const diff = openedAt - m.start_time
        if (diff >= -1800 && diff <= 1200) {
          if (!best || Math.abs(diff) < Math.abs(best.diff)) best = { matchId: String(m.match_id), diff }
        }
      }
    }
    if (!best) return // match not finished/indexed yet — retry next poll

    const match = await fetchMatch(best.matchId)
    if (!match || !match.players) return

    // Determine the group's result via the team most mapped players are on.
    const allSteam32 = steamIds.map((s) => parseInt(toAccountId(s), 10))
    const found = match.players.filter((p: any) => allSteam32.includes(p.account_id))
    if (found.length === 0) return // wrong match — bail and retry

    let radiantCount = 0
    let direCount = 0
    for (const p of found) {
      if (p.player_slot < 128) radiantCount++
      else direCount++
    }
    const groupIsRadiant = radiantCount >= direCount
    const groupWon: boolean = groupIsRadiant ? match.radiant_win : !match.radiant_win

    const results: string[] = []
    for (const bet of round.bets) {
      const stats = ensurePlayer(data, bet.bettorId, bet.bettorName)
      const won = (bet.prediction === 'win' && groupWon) || (bet.prediction === 'lose' && !groupWon)
      if (won) { stats.points += 100; stats.wins++ }
      else { stats.points = Math.max(0, stats.points - 50); stats.losses++ }
      const pick = bet.prediction === 'win' ? msg('nós', 'win') : msg('eles', 'lose')
      results.push(`${won ? '✅' : '❌'} ${bet.bettorDisplayName} (${pick}) → ${stats.points} pts`)
    }

    data.round = null
    saveBets(data)

    const nicks = round.players.map((p) => p.dotaNick).join(', ')
    const outcome = groupWon ? msg('VITÓRIA', 'WIN') : msg('DERROTA', 'LOSS')
    const embed = new EmbedBuilder()
      .setColor(groupWon ? 0x00cc66 : 0xff3333)
      .setTitle(msg('🏁 Aposta resolvida', '🏁 Round resolved'))
      .setDescription(
        `${msg('Jogo de', 'Game of')} **${nicks}** — **${outcome}**\n` +
        `${msg('Partida', 'Match')}: \`${best.matchId}\`\n\n` +
        (results.join('\n') || msg('_(sem apostas)_', '_(no bets)_'))
      )
      .setTimestamp()
    await postEmbed(embed)
    console.log(`[BetHandler] Auto-resolved round (match ${best.matchId}), ${round.bets.length} bet(s)`)
  }

  /**
   * !betwin <matchId>
   * Resolves all active bets using OpenDota match data.
   */
  static async resolveByMatch(message: Message, matchId: string) {
    if (!matchId || isNaN(Number(matchId))) {
      message.reply(t('bet.resolveUsage'))
      return
    }

    await message.channel.send(t('bet.resolveStart', { id: matchId }))

    const outcome = await BetHandler.resolveBetsForMatch(matchId, { verbose: true })
    if (outcome === 'no-match') {
      message.reply(t('bet.resolveFailed', { id: matchId }))
      return
    }
    if (outcome === 'no-bets') {
      message.reply(t('bet.resolveNoActive'))
      return
    }

    message.channel.send({ embeds: [outcome.embed] })
  }

  /**
   * Core bet-resolution logic shared by the manual `!betwin` command and the
   * automatic live-bet resolver. Resolves every active bet whose target played
   * in `matchId`, applies the timing guard, updates the leaderboard and persists.
   *
   * Returns 'no-match' if the match can't be fetched, 'no-bets' if there are no
   * active bets, otherwise an embed plus how many bets were actually resolved
   * (won/lost/voided). Bets whose target isn't in this match are left untouched.
   * With { verbose: false } the noise lines (skipped / not-in-match) are omitted.
   */
  static async resolveBetsForMatch(
    matchId: string,
    opts: { verbose: boolean }
  ): Promise<{ embed: EmbedBuilder; resolvedCount: number } | 'no-match' | 'no-bets'> {
    const match = await fetchMatch(matchId)
    if (!match || !match.players) return 'no-match'

    const data = loadBets()
    if (data.activeBets.length === 0) return 'no-bets'

    const results: string[] = []
    let resolvedCount = 0

    for (const bet of [...data.activeBets]) {
      const steamIds = getSteamIdsFor(bet.targetName)
      if (steamIds.length === 0) {
        console.log(`[BetHandler] No Steam ID for ${bet.targetName} — cannot resolve`)
        if (opts.verbose) results.push(t('bet.resolveSkipped', { bettor: bet.bettorName, target: bet.targetName }))
        continue
      }

      // The target may have multiple Steam accounts — match against any of them
      const accountIds = steamIds.map((s) => parseInt(s, 10))
      const player = match.players.find((p: any) => accountIds.includes(p.account_id))

      if (!player) {
        if (opts.verbose) results.push(t('bet.resolveNotInMatch', { bettor: bet.bettorName, target: bet.targetName }))
        continue
      }

      // Timing verification
      const betTimeSeconds = Math.floor(new Date(bet.timestamp).getTime() / 1000)
      const matchStartTimeSeconds = match.start_time
      const diffSeconds = betTimeSeconds - matchStartTimeSeconds

      const isTurbo = match.game_mode === 23
      const limitSeconds = isTurbo ? 300 : 600

      if (diffSeconds > limitSeconds) {
        results.push(
          t('bet.resolveVoided', {
            bettor: bet.bettorDisplayName ?? bet.bettorName,
            target: bet.targetDotaNick ?? bet.targetName,
            time: Math.floor(diffSeconds / 60)
          })
        )
        data.activeBets = data.activeBets.filter((b) => b.bettorId !== bet.bettorId)
        resolvedCount++
        continue
      }

      const isRadiant = player.player_slot < 128
      const didWin: boolean = isRadiant ? match.radiant_win : !match.radiant_win
      const betWon = (bet.prediction === 'win' && didWin) || (bet.prediction === 'lose' && !didWin)

      const bettorStats = ensurePlayer(data, bet.bettorId, bet.bettorName)

      const resolveLabel = bet.prediction === 'win' ? t('bet.predWin') : t('bet.predLose')
      if (betWon) {
        bettorStats.points += 100
        bettorStats.wins++
        results.push(
          t('bet.resolveWon', { bettor: bet.bettorDisplayName ?? bet.bettorName, pred: resolveLabel, target: bet.targetDotaNick ?? bet.targetName, pts: bettorStats.points })
        )
      } else {
        bettorStats.points = Math.max(0, bettorStats.points - 50)
        bettorStats.losses++
        results.push(
          t('bet.resolveLost', { bettor: bet.bettorDisplayName ?? bet.bettorName, pred: resolveLabel, target: bet.targetDotaNick ?? bet.targetName, pts: bettorStats.points })
        )
      }

      data.activeBets = data.activeBets.filter((b) => b.bettorId !== bet.bettorId)
      resolvedCount++
    }

    saveBets(data)

    const embed = new EmbedBuilder()
      .setColor(0xffd700)
      .setTitle(t('bet.resolveTitle', { id: matchId }))
      .setDescription(results.join('\n') || t('bet.resolveEmpty'))
      .setFooter({ text: t('bet.resolveFooter', { id: matchId }) })

    return { embed, resolvedCount }
  }

  /**
   * Automatic resolver: for every active bet, look up the target's recent
   * matches on OpenDota, find the finished match the bet was placed for (started
   * shortly before/after the bet) and resolve it without a manual `!betwin`.
   * Posts a result embed via `postEmbed` only when at least one bet is resolved.
   */
  static async autoResolveActiveBets(postEmbed: (embed: EmbedBuilder) => Promise<void>) {
    const data = loadBets()
    if (data.activeBets.length === 0) return

    const targets = [...new Set(data.activeBets.map((b) => b.targetName))]
    const candidateMatchIds = new Set<string>()

    for (const target of targets) {
      const steamIds = getSteamIdsFor(target)
      if (steamIds.length === 0) continue

      const betTimes = data.activeBets
        .filter((b) => b.targetName === target)
        .map((b) => Math.floor(new Date(b.timestamp).getTime() / 1000))
      const earliestBet = Math.min(...betTimes)

      for (const sid of steamIds) {
        const recent = await fetchRecentMatches(toAccountId(sid))
        if (!recent) continue
        for (const m of recent) {
          // The match the bet was placed for: bet happened from ~5 min before to
          // ~30 min after the match's start. resolveBetsForMatch then applies the
          // strict per-bet timing guard (voids bets placed too late).
          const diff = earliestBet - m.start_time
          if (diff >= -300 && diff <= 1800) candidateMatchIds.add(String(m.match_id))
        }
      }
    }

    for (const matchId of candidateMatchIds) {
      const outcome = await BetHandler.resolveBetsForMatch(matchId, { verbose: false })
      if (outcome !== 'no-match' && outcome !== 'no-bets' && outcome.resolvedCount > 0) {
        await postEmbed(outcome.embed)
        console.log(`[BetHandler] Auto-resolved ${outcome.resolvedCount} bet(s) from match ${matchId}`)
      }
    }
  }

  /**
   * Cancel a specific bet: !cancelbet @target
   */
  static async cancelBet(message: Message) {
    const mention = message.mentions.users.first()
    if (!mention) {
      message.reply(t('bet.cancelUsage'))
      return
    }

    const data = loadBets()
    const idx = data.activeBets.findIndex(
      (b) => b.bettorId === message.author.id && b.targetName === mention.username
    )

    if (idx === -1) {
      const nick = await fetchDotaNick(DISCORD_TO_STEAM[mention.username], mention.username)
      message.reply(t('bet.cancelNoBet', { nick }))
      return
    }

    const bet = data.activeBets.splice(idx, 1)[0]
    saveBets(data)

    const cancelLabel = bet.prediction === 'win' ? t('bet.predWin') : t('bet.predLose')
    message.reply(t('bet.cancelConfirm', { pred: cancelLabel, nick: bet.targetDotaNick }))
  }

  /**
   * Show all active bets: !bets
   */
  static showActiveBets(message: Message) {
    const data = loadBets()

    if (data.activeBets.length === 0) {
      message.reply(t('bet.noActiveBetsMore'))
      return
    }

    const betsText = data.activeBets
      .map(
        (bet, i) =>
          `${i + 1}. **${bet.bettorDisplayName ?? bet.bettorName}** → **${bet.targetDotaNick ?? bet.targetName}**: **${bet.prediction === 'win' ? t('bet.predWin') : t('bet.predLose')}**`
      )
      .join('\n')

    const embed = new EmbedBuilder()
      .setColor(0xffa500)
      .setTitle(t('bet.activeBetsTitle'))
      .setDescription(betsText)
      .setFooter({ text: t('bet.activeBetsFooter') })

    message.channel.send({ embeds: [embed] })
  }

  /**
   * Show leaderboard: !leaderboard
   */
  static showLeaderboard(message: Message) {
    const data = loadBets()
    const entries = Object.entries(data.leaderboard)

    if (entries.length === 0) {
      message.reply(t('bet.leaderboardNoData'))
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
      .setTitle(t('bet.leaderboardTitle'))
      .setDescription(leaderboardText)
      .setFooter({ text: t('bet.leaderboardFooter') })

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
      t('bet.balanceLine', { name: message.author.username, pts: player.points, wins: player.wins, losses: player.losses })
    )
  }
}
