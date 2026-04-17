import { Message, EmbedBuilder } from 'discord.js'
import fs from 'fs'
import https from 'https'
import { t } from '../i18n'
import { DISCORD_TO_STEAM, fetchDotaNick } from './PlayerData'

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
      message.reply(t('bet.usage'))
      return
    }

    const mention = message.mentions.users.first()
    if (!mention) {
      message.reply(t('bet.noTarget'))
      return
    }

    const rawPrediction = parts[parts.length - 1].toLowerCase()
    let prediction: 'win' | 'lose'

    if (rawPrediction === 'nós' || rawPrediction === 'nos') {
      prediction = 'win'
    } else if (rawPrediction === 'eles') {
      prediction = 'lose'
    } else {
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

    saveBets(data)

    const predLabel = prediction === 'win' ? t('bet.predWin') : t('bet.predLose')
    const embed = new EmbedBuilder()
      .setColor(prediction === 'win' ? 0x00cc66 : 0xff3333)
      .setTitle(t('bet.betTitle'))
      .setDescription(t('bet.betDesc', { bettor: bettorDisplayName, pred: predLabel, target: targetDotaNick }))
      .setFooter({ text: t('bet.betFooter', { user: mention.username }) })

    message.channel.send({ embeds: [embed] })
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

    const match = await fetchMatch(matchId)
    if (!match || !match.players) {
      message.reply(t('bet.resolveFailed', { id: matchId }))
      return
    }

    const data = loadBets()
    if (data.activeBets.length === 0) {
      message.reply(t('bet.resolveNoActive'))
      return
    }

    const results: string[] = []

    for (const bet of [...data.activeBets]) {
      const steamId = DISCORD_TO_STEAM[bet.targetName]
      if (!steamId) {
        console.log(`[BetHandler] No Steam ID for ${bet.targetName} — cannot resolve`)
        results.push(t('bet.resolveSkipped', { bettor: bet.bettorName, target: bet.targetName }))
        continue
      }

      const accountId32 = parseInt(steamId, 10)
      const player = match.players.find((p: any) => p.account_id === accountId32)

      if (!player) {
        console.log(`[BetHandler] ${bet.targetName} (steam32: ${steamId}) not found in match ${matchId}`)
        results.push(t('bet.resolveNotInMatch', { bettor: bet.bettorName, target: bet.targetName }))
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
    }

    saveBets(data)

    const embed = new EmbedBuilder()
      .setColor(0xffd700)
      .setTitle(t('bet.resolveTitle', { id: matchId }))
      .setDescription(results.join('\n') || t('bet.resolveEmpty'))
      .setFooter({ text: t('bet.resolveFooter', { id: matchId }) })

    message.channel.send({ embeds: [embed] })
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
