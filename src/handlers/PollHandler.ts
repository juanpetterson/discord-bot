import { Message, EmbedBuilder } from 'discord.js'

interface PollSession {
  question: string
  options: string[]
  votes: Map<string, number> // voter userId -> option index
  createdBy: string
  messageId: string
  timeout: NodeJS.Timeout
}

const activePolls = new Map<string, PollSession>() // guildId -> poll

const NUMBER_EMOJIS = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣']

export class PollHandler {
  /**
   * Create a poll.
   * Format: !poll Question? | Option1 | Option2 | Option3
   * If no options: defaults to Yes / No
   */
  static async createPoll(message: Message, args: string) {
    const guild = message.guild
    if (!guild) return

    if (activePolls.has(guild.id)) {
      message.reply("There's already an active poll! Wait for it to end or use `!endpoll`.")
      return
    }

    const parts = args.split('|').map((s) => s.trim())
    const question = parts[0]

    if (!question) {
      message.reply('Usage: `!poll Question? | Option1 | Option2` or `!poll Question?` (defaults to Yes/No)')
      return
    }

    let options: string[]
    if (parts.length <= 1) {
      options = ['Yes', 'No']
    } else {
      options = parts.slice(1).filter((o) => o.length > 0)
      if (options.length < 2) {
        message.reply('You need at least 2 options!')
        return
      }
      if (options.length > 9) {
        message.reply('Maximum 9 options!')
        return
      }
    }

    const optionsText = options
      .map((opt, i) => `${NUMBER_EMOJIS[i]} ${opt}`)
      .join('\n')

    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle(`📊 ${question}`)
      .setDescription(optionsText + '\n\nVote with `!vote <number>`')
      .setFooter({ text: `Poll by ${message.author.username} | Ends in 2 minutes | !endpoll to end early` })

    const pollMessage = await message.channel.send({ embeds: [embed] })

    const timeout = setTimeout(() => {
      PollHandler.endPoll(message, true)
    }, 120000) // 2 minutes

    activePolls.set(guild.id, {
      question,
      options,
      votes: new Map(),
      createdBy: message.author.id,
      messageId: pollMessage.id,
      timeout,
    })
  }

  static vote(message: Message, voteArg: string) {
    const guild = message.guild
    if (!guild) return

    const session = activePolls.get(guild.id)
    if (!session) {
      message.reply("There's no active poll right now!")
      return
    }

    const optionIndex = parseInt(voteArg) - 1
    if (isNaN(optionIndex) || optionIndex < 0 || optionIndex >= session.options.length) {
      message.reply(`Vote for a valid option (1-${session.options.length})!`)
      return
    }

    const previousVote = session.votes.get(message.author.id)
    session.votes.set(message.author.id, optionIndex)

    if (previousVote !== undefined) {
      message.react('🔄') // Changed vote
    } else {
      message.react('✅') // New vote
    }
  }

  static endPoll(message: Message, isTimeout = false) {
    const guild = message.guild
    if (!guild) return

    const session = activePolls.get(guild.id)
    if (!session) {
      if (!isTimeout) message.reply("There's no active poll!")
      return
    }

    clearTimeout(session.timeout)
    activePolls.delete(guild.id)

    // Count votes
    const voteCounts = new Array(session.options.length).fill(0)
    session.votes.forEach((optionIndex) => {
      voteCounts[optionIndex]++
    })

    const totalVotes = session.votes.size
    const maxVotes = Math.max(...voteCounts)
    const winnerIndex = voteCounts.indexOf(maxVotes)

    const resultsText = session.options
      .map((opt, i) => {
        const count = voteCounts[i]
        const percentage = totalVotes > 0 ? Math.round((count / totalVotes) * 100) : 0
        const bar = '█'.repeat(Math.round(percentage / 10)) + '░'.repeat(10 - Math.round(percentage / 10))
        const winner = i === winnerIndex && totalVotes > 0 ? ' 👑' : ''
        return `${NUMBER_EMOJIS[i]} **${opt}** ${bar} ${count} votes (${percentage}%)${winner}`
      })
      .join('\n')

    const embed = new EmbedBuilder()
      .setColor(0x00ff00)
      .setTitle(`📊 Poll Results: ${session.question}`)
      .setDescription(resultsText)
      .setFooter({ text: `Total votes: ${totalVotes} | ${isTimeout ? 'Poll timed out' : 'Poll ended'}` })

    message.channel.send({ embeds: [embed] })
  }
}
