import { Message, EmbedBuilder } from 'discord.js'
import fs from 'fs'

const BETS_FILE = './src/assets/data/bets.json'

interface PlayerBets {
  points: number
  wins: number
  losses: number
}

interface ActiveBet {
  bettorId: string
  bettorName: string
  targetPlayer: string
  prediction: string
  amount: number
  timestamp: string
}

interface BetsData {
  leaderboard: Record<string, PlayerBets>
  activeBets: ActiveBet[]
}

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

function ensurePlayer(data: BetsData, id: string): PlayerBets {
  if (!data.leaderboard[id]) {
    data.leaderboard[id] = { points: 1000, wins: 0, losses: 0 }
  }
  return data.leaderboard[id]
}

const PREDICTIONS = [
  'most kills',
  'most deaths',
  'most assists',
  'first blood',
  'mvp',
  'feeder',
  'carry',
  'win',
  'lose',
]

export class BetHandler {
  /**
   * Place a bet: !bet <amount> <player> <prediction>
   * Example: !bet 100 carlesso most kills
   */
  static placeBet(message: Message, args: string) {
    const parts = args.trim().split(/\s+/)

    if (parts.length < 3) {
      message.reply(
        'Usage: `!bet <amount> <player> <prediction>`\n' +
        'Example: `!bet 100 carlesso most kills`\n\n' +
        'Predictions: ' + PREDICTIONS.map(p => `\`${p}\``).join(', ')
      )
      return
    }

    const amount = parseInt(parts[0])
    if (isNaN(amount) || amount <= 0) {
      message.reply('Bet amount must be a positive number!')
      return
    }

    const targetPlayer = parts[1]
    const prediction = parts.slice(2).join(' ').toLowerCase()

    const data = loadBets()
    const bettor = ensurePlayer(data, message.author.id)

    if (amount > bettor.points) {
      message.reply(`You don't have enough points! You have **${bettor.points}** points.`)
      return
    }

    // Check if already has an active bet
    const existingBet = data.activeBets.find(b => b.bettorId === message.author.id)
    if (existingBet) {
      message.reply(`You already have an active bet! Use \`!cancelbet\` to cancel it first.`)
      return
    }

    // Deduct points
    bettor.points -= amount

    data.activeBets.push({
      bettorId: message.author.id,
      bettorName: message.author.username,
      targetPlayer,
      prediction,
      amount,
      timestamp: new Date().toISOString(),
    })

    saveBets(data)

    const embed = new EmbedBuilder()
      .setColor(0xffa500)
      .setTitle('🎰 Bet Placed!')
      .setDescription(
        `**${message.author.username}** bet **${amount} points** on **${targetPlayer}** — *${prediction}*`
      )
      .setFooter({ text: `Remaining balance: ${bettor.points} points` })

    message.channel.send({ embeds: [embed] })
  }

  /**
   * Resolve a bet as won: !betwin @user
   * Anyone can confirm a winner
   */
  static resolveBet(message: Message, targetUserId: string, won: boolean) {
    const data = loadBets()

    // Find by mention or by username
    let betIndex = data.activeBets.findIndex(b => b.bettorId === targetUserId)
    
    if (betIndex === -1) {
      // Try by username
      const mention = message.mentions.users.first()
      if (mention) {
        betIndex = data.activeBets.findIndex(b => b.bettorId === mention.id)
      }
    }

    if (betIndex === -1) {
      message.reply('No active bet found for that user!')
      return
    }

    const bet = data.activeBets[betIndex]
    const bettor = ensurePlayer(data, bet.bettorId)

    if (won) {
      const winnings = bet.amount * 2
      bettor.points += winnings
      bettor.wins++
      message.channel.send(
        `🏆 **${bet.bettorName}** WON the bet! (+${winnings} points)\n` +
        `Bet: ${bet.amount} on ${bet.targetPlayer} — *${bet.prediction}*\n` +
        `New balance: **${bettor.points}** points`
      )
    } else {
      bettor.losses++
      message.channel.send(
        `💸 **${bet.bettorName}** LOST the bet! (-${bet.amount} points)\n` +
        `Bet: ${bet.amount} on ${bet.targetPlayer} — *${bet.prediction}*\n` +
        `New balance: **${bettor.points}** points`
      )
    }

    data.activeBets.splice(betIndex, 1)
    saveBets(data)
  }

  /**
   * Cancel your own bet
   */
  static cancelBet(message: Message) {
    const data = loadBets()
    const betIndex = data.activeBets.findIndex(b => b.bettorId === message.author.id)

    if (betIndex === -1) {
      message.reply("You don't have an active bet!")
      return
    }

    const bet = data.activeBets[betIndex]
    const bettor = ensurePlayer(data, message.author.id)
    bettor.points += bet.amount

    data.activeBets.splice(betIndex, 1)
    saveBets(data)

    message.reply(`🔄 Bet cancelled. ${bet.amount} points refunded. Balance: **${bettor.points}** points.`)
  }

  /**
   * Show leaderboard
   */
  static showLeaderboard(message: Message) {
    const data = loadBets()
    const entries = Object.entries(data.leaderboard)

    if (entries.length === 0) {
      message.reply('No bets have been placed yet! Start with `!bet <amount> <player> <prediction>`')
      return
    }

    const sorted = entries.sort(([, a], [, b]) => b.points - a.points)

    const medals = ['🥇', '🥈', '🥉']
    const leaderboardText = sorted
      .slice(0, 10)
      .map(([userId, stats], index) => {
        const medal = medals[index] || `**${index + 1}.**`
        // We'll use a cached name from active bets or fallback
        const activeBet = data.activeBets.find(b => b.bettorId === userId)
        const name = activeBet?.bettorName || userId
        return `${medal} ${name} — **${stats.points}** pts (${stats.wins}W/${stats.losses}L)`
      })
      .join('\n')

    const embed = new EmbedBuilder()
      .setColor(0xffd700)
      .setTitle('🏆 Betting Leaderboard')
      .setDescription(leaderboardText)
      .setFooter({ text: 'Everyone starts with 1000 points | !bet to play' })

    message.channel.send({ embeds: [embed] })
  }

  /**
   * Show active bets
   */
  static showActiveBets(message: Message) {
    const data = loadBets()

    if (data.activeBets.length === 0) {
      message.reply('No active bets right now! Use `!bet <amount> <player> <prediction>`')
      return
    }

    const betsText = data.activeBets
      .map((bet, i) => `${i + 1}. **${bet.bettorName}** — ${bet.amount} pts on **${bet.targetPlayer}** (*${bet.prediction}*)`)
      .join('\n')

    const embed = new EmbedBuilder()
      .setColor(0xffa500)
      .setTitle('🎰 Active Bets')
      .setDescription(betsText)
      .setFooter({ text: '!betwin @user or !betlose @user to resolve' })

    message.channel.send({ embeds: [embed] })
  }

  /**
   * Check balance
   */
  static checkBalance(message: Message) {
    const data = loadBets()
    const player = ensurePlayer(data, message.author.id)
    saveBets(data) // in case it was newly created

    message.reply(`💰 **${message.author.username}** — Balance: **${player.points}** points | ${player.wins}W / ${player.losses}L`)
  }
}
