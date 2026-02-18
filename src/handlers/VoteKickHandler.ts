import { Message, GuildMember } from 'discord.js'

interface VoteKickSession {
  targetMember: GuildMember
  initiator: GuildMember
  requiredVotes: number
  voters: Set<string> // user IDs who voted yes
  channelId: string
  messageChannelId: string
  timeout: NodeJS.Timeout
}

// Only one votekick at a time per guild
const activeVoteKicks = new Map<string, VoteKickSession>()

export class VoteKickHandler {
  static getActiveSession(guildId: string): VoteKickSession | undefined {
    return activeVoteKicks.get(guildId)
  }

  static async startVoteKick(message: Message, targetName: string) {
    const guild = message.guild
    if (!guild) return

    const channel = message.member?.voice.channel
    if (!channel) {
      message.reply('You need to be in a voice channel to start a votekick!')
      return
    }

    // Check if there's already an active votekick
    if (activeVoteKicks.has(guild.id)) {
      message.reply('There\'s already an active votekick! Wait for it to finish.')
      return
    }

    // Find the target member by closest nickname match
    const members = channel.members.filter(
      (member: GuildMember) => !member.user.bot
    )

    if (members.size <= 2) {
      message.reply('Need at least 3 people in the channel to start a votekick!')
      return
    }

    const targetNameLower = targetName.toLowerCase().trim()
    let bestMatch: GuildMember | null = null
    let bestScore = Infinity

    // Exclude the initiator from the candidate pool to avoid self-match
    const candidates = members.filter((m: GuildMember) => m.id !== message.author.id)

    candidates.forEach((member: GuildMember) => {
      const displayName = member.displayName.toLowerCase()
      const username = member.user.username.toLowerCase()

      // Exact match
      if (displayName === targetNameLower || username === targetNameLower) {
        bestMatch = member
        bestScore = 0
        return
      }

      // Starts with
      if (displayName.startsWith(targetNameLower) || username.startsWith(targetNameLower)) {
        const score = 1
        if (score < bestScore) {
          bestMatch = member
          bestScore = score
        }
        return
      }

      // Contains
      if (displayName.includes(targetNameLower) || username.includes(targetNameLower)) {
        const score = 2
        if (score < bestScore) {
          bestMatch = member
          bestScore = score
        }
        return
      }

      // Levenshtein-like: check character overlap
      const overlapScore = getMatchScore(targetNameLower, displayName)
      const overlapScoreUsername = getMatchScore(targetNameLower, username)
      const minOverlap = Math.min(overlapScore, overlapScoreUsername)

      if (minOverlap < bestScore) {
        bestMatch = member
        bestScore = minOverlap
      }
    })

    if (!bestMatch) {
      message.reply(`Could not find anyone matching "${targetName}" in the voice channel.`)
      return
    }

    const target = bestMatch as GuildMember

    // Don't allow kicking yourself
    if (target.id === message.author.id) {
      message.reply('You can\'t votekick yourself! 🤡')
      return
    }

    // Calculate required votes: half + 1 of non-bot members (excluding the target)
    const voterCount = members.filter((m: GuildMember) => m.id !== target.id).size
    const requiredVotes = Math.floor(voterCount / 2) + 1

    // Create the votekick session - initiator automatically votes yes
    const session: VoteKickSession = {
      targetMember: target,
      initiator: message.member as GuildMember,
      requiredVotes,
      voters: new Set([message.author.id]),
      channelId: channel.id,
      messageChannelId: message.channel.id,
      timeout: setTimeout(() => {
        activeVoteKicks.delete(guild.id)
        message.channel.send(`⌛ Votekick against **${target.displayName}** expired! Not enough votes.`)
      }, 60000), // 60 seconds to vote
    }

    activeVoteKicks.set(guild.id, session)

    const currentVotes = session.voters.size

    message.channel.send(
      `🗳️ **VOTEKICK** initiated by **${message.member?.displayName}**!\n\n` +
      `Target: **${target.displayName}**\n` +
      `Votes: ${currentVotes}/${requiredVotes}\n\n` +
      `Type \`!voteyes\` to vote for the kick.\n` +
      `⏱️ You have 60 seconds to vote!`
    )

    // Check if the initiator's vote alone is enough (e.g., 2 voters, need 2, initiator = 1... no)
    if (currentVotes >= requiredVotes) {
      await this.executeKick(guild.id, message)
    }
  }

  static async voteYes(message: Message) {
    const guild = message.guild
    if (!guild) return

    const session = activeVoteKicks.get(guild.id)
    if (!session) {
      message.reply('There\'s no active votekick right now!')
      return
    }

    const voterChannel = message.member?.voice.channel
    if (!voterChannel || voterChannel.id !== session.channelId) {
      message.reply('You need to be in the same voice channel to vote!')
      return
    }

    if (message.author.id === session.targetMember.id) {
      message.reply('You can\'t vote on your own kick! 😂')
      return
    }

    if (session.voters.has(message.author.id)) {
      message.reply('You already voted! 🗳️')
      return
    }

    session.voters.add(message.author.id)

    const currentVotes = session.voters.size
    message.channel.send(
      `✅ **${message.member?.displayName}** voted YES! (${currentVotes}/${session.requiredVotes})`
    )

    if (currentVotes >= session.requiredVotes) {
      await this.executeKick(guild.id, message)
    }
  }

  private static async executeKick(guildId: string, message: Message) {
    const session = activeVoteKicks.get(guildId)
    if (!session) return

    clearTimeout(session.timeout)
    activeVoteKicks.delete(guildId)

    try {
      const kickMessages = [
        `🦶 **${session.targetMember.displayName}** has been KICKED by democracy! The people have spoken! 🗳️`,
        `👢 **${session.targetMember.displayName}** was voted off the island! 🏝️`,
        `🚪 **${session.targetMember.displayName}** — the door is that way → 🚶`,
        `⚖️ The court has decided: **${session.targetMember.displayName}** is GUILTY. Disconnected! 🔨`,
        `🎪 **${session.targetMember.displayName}** has left the circus! 🤡`,
      ]

      const randomMessage = kickMessages[Math.floor(Math.random() * kickMessages.length)]

      await session.targetMember.voice.disconnect('VoteKick - majority voted')
      message.channel.send(randomMessage)
    } catch (error) {
      console.error('Error executing votekick:', error)
      message.channel.send(`Failed to kick **${session.targetMember.displayName}**. I might not have permission! 😤`)
      activeVoteKicks.delete(guildId)
    }
  }
}

// Simple fuzzy match score (lower is better)
function getMatchScore(search: string, target: string): number {
  if (target.includes(search)) return 2

  let matchCount = 0
  let searchIdx = 0

  for (let i = 0; i < target.length && searchIdx < search.length; i++) {
    if (target[i] === search[searchIdx]) {
      matchCount++
      searchIdx++
    }
  }

  if (matchCount === 0) return 100

  // Score based on how many chars matched vs search length
  return Math.round((1 - matchCount / search.length) * 50) + 3
}
