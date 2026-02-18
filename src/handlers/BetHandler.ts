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

// Reverse map: steam account id → discord id
export const STEAM_TO_DISCORD: Record<string, string> = Object.fromEntries(
  Object.entries(DISCORD_TO_STEAM).map(([d, s]) => [s, d])
)

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
  /** Discord ID of the player being bet on */
  targetDiscordId: string
  targetName: string
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

function fetchRecentMatch(accountId: string): Promise<any> {
  return new Promise((resolve) => {
    const url = `https://api.opendota.com/api/players/${accountId}/recentMatches`
    https
      .get(url, (res) => {
        let body = ''
        res.on('data', (chunk) => (body += chunk))
        res.on('end', () => {
          try {
            const matches = JSON.parse(body)
            resolve(Array.isArray(matches) && matches.length > 0 ? matches[0] : null)
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

    // ── Check if the match has already started & whether bets are still open ──
    const steamId = DISCORD_TO_STEAM[mention.id]
    if (steamId) {
      try {
        const recentMatch = await fetchRecentMatch(steamId)
        if (recentMatch) {
          const startTimestamp: number = recentMatch.start_time
          const gameMode: number = recentMatch.game_mode
          const elapsedMinutes = (Date.now() / 1000 - startTimestamp) / 60
          const isTurbo = gameMode === 23
          const limitMinutes = isTurbo ? 5 : 10

          console.log(
            `[BetHandler] Recent match for ${mention.username}: elapsed=${elapsedMinutes.toFixed(1)} min, turbo=${isTurbo}, limit=${limitMinutes} min`
          )

          if (elapsedMinutes > limitMinutes) {
            message.reply(
              `⏰ Bets are closed! The match started **${elapsedMinutes.toFixed(0)} minutes ago** ` +
                `(limit: ${limitMinutes} min for ${isTurbo ? 'Turbo' : 'Normal/Ranked'} matches).`
            )
            return
          }
        }
      } catch (err) {
        console.warn('[BetHandler] Could not check match time:', err)
      }
    } else {
      console.log(`[BetHandler] No Steam ID mapped for Discord user ${mention.id} (${mention.username}) — skipping time check`)
    }

    const data = loadBets()
    ensurePlayer(data, message.author.id, message.author.username)

    // One active bet per bettor
    const existingBet = data.activeBets.find((b) => b.bettorId === message.author.id)
    if (existingBet) {
      message.reply(
        `You already have an active bet on **${existingBet.targetName}** (${existingBet.prediction}). Use \`!cancelbet\` first.`
      )
      return
    }

    ensurePlayer(data, mention.id, mention.username)

    data.activeBets.push({
      bettorId: message.author.id,
      bettorName: message.author.username,
      targetDiscordId: mention.id,
      targetName: mention.username,
      prediction,
      timestamp: new Date().toISOString(),
    })

    saveBets(data)

    const predLabel = prediction === 'win' ? '🏆 WIN' : '💀 LOSE'
    const embed = new EmbedBuilder()
      .setColor(prediction === 'win' ? 0x00cc66 : 0xff3333)
      .setTitle('🎰 Bet Placed!')
      .setDescription(`**${message.author.username}** bets that **${mention.username}** will **${predLabel}**!`)
      .setFooter({ text: '!cancelbet to cancel | !bets to see active bets' })

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
      const steamId = DISCORD_TO_STEAM[bet.targetDiscordId]
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
          `✅ **${bet.bettorName}** WON! (+100 pts) — bet **${bet.prediction === 'win' ? '🏆 WIN' : '💀 LOSE'}** on ${bet.targetName} — Balance: **${bettorStats.points}**`
        )
      } else {
        bettorStats.points = Math.max(0, bettorStats.points - 50)
        bettorStats.losses++
        results.push(
          `❌ **${bet.bettorName}** LOST! (-50 pts) — bet **${bet.prediction === 'win' ? '🏆 WIN' : '💀 LOSE'}** on ${bet.targetName} — Balance: **${bettorStats.points}**`
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
   * Cancel your own active bet: !cancelbet
   */
  static cancelBet(message: Message) {
    const data = loadBets()
    const idx = data.activeBets.findIndex((b) => b.bettorId === message.author.id)

    if (idx === -1) {
      message.reply("You don't have an active bet!")
      return
    }

    const bet = data.activeBets.splice(idx, 1)[0]
    saveBets(data)

    message.reply(`🔄 Bet cancelled. You had bet **${bet.prediction}** on **${bet.targetName}**.`)
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
          `${i + 1}. **${bet.bettorName}** → ${bet.targetName}: **${bet.prediction === 'win' ? '🏆 WIN' : '💀 LOSE'}**`
      )
      .join('\n')

    const embed = new EmbedBuilder()
      .setColor(0xffa500)
      .setTitle('🎰 Active Bets')
      .setDescription(betsText)
      .setFooter({ text: '!betwin <matchId> to resolve | !cancelbet to cancel yours' })

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
