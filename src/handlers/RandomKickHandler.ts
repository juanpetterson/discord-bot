import { Message, GuildMember, VoiceBasedChannel, Collection } from 'discord.js'

export class RandomKickHandler {
  static async execute(message: Message) {
    const channel = message.member?.voice.channel

    if (!channel) {
      message.reply('You need to be in a voice channel to use this command!')
      return
    }

    const members = channel.members.filter(
      (member: GuildMember) => !member.user.bot
    )

    if (members.size <= 1) {
      message.reply('There needs to be more than 1 person in the channel for Russian Roulette! 🎰')
      return
    }

    // Build suspense message
    const memberArray = Array.from(members.values())
    const randomIndex = Math.floor(Math.random() * memberArray.length)
    const victim = memberArray[randomIndex]

    const suspenseMessages = [
      '🔫 Spinning the chamber...',
      '🎰 The wheel of fate turns...',
      '💀 Someone is about to get disconnected...',
      '😈 Eeny, meeny, miny, moe...',
    ]

    const randomSuspenseMessage = suspenseMessages[Math.floor(Math.random() * suspenseMessages.length)]

    await message.channel.send(randomSuspenseMessage)

    // Wait 2 seconds for suspense
    await new Promise((resolve) => setTimeout(resolve, 2000))

    const farewellMessages = [
      `💥 BANG! **${victim.displayName}** got shot! Goodbye! 👋`,
      `🎯 The bullet found **${victim.displayName}**! See ya! 💀`,
      `💣 BOOM! **${victim.displayName}** has been eliminated! 🪦`,
      `🔫 *click* ... 💥 **${victim.displayName}** is OUT! Adeus! 🫡`,
      `☠️ RIP **${victim.displayName}**. You will not be missed. 😂`,
    ]

    const randomFarewell = farewellMessages[Math.floor(Math.random() * farewellMessages.length)]

    try {
      await victim.voice.disconnect('Russian Roulette - randomckick')
      message.channel.send(randomFarewell)
    } catch (error) {
      console.error('Error disconnecting member:', error)
      message.channel.send(`I tried to kick **${victim.displayName}** but I don't have permission! 😤`)
    }
  }
}
