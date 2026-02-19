import { Message, GuildMember } from 'discord.js'
import { t } from '../i18n'

export class RandomKickHandler {
  static async execute(message: Message) {
    console.log(`[RandomKick] Command triggered by ${message.author.username} (${message.author.id})`)

    const member = message.member
    if (!member) {
      console.log(`[RandomKick] ERROR: message.member is null/undefined`)
      message.reply('Could not resolve your guild member. Try again!')
      return
    }

    const channel = member.voice?.channel

    console.log(`[RandomKick] Caller voice channel: ${channel?.name ?? 'none'} (${channel?.id ?? 'N/A'})`)

    if (!channel) {
      message.reply('You need to be in a voice channel to use this command!')
      return
    }

    const members = channel.members.filter(
      (member: GuildMember) => !member.user.bot
    )

    console.log(`[RandomKick] Members in channel (non-bot): ${members.size} — [${members.map((m: GuildMember) => m.user.username).join(', ')}]`)

    if (members.size <= 1) {
      message.reply(t('randomkick.notEnough'))
      return
    }

    // Build suspense message
    const memberArray = Array.from(members.values())
    const randomIndex = Math.floor(Math.random() * memberArray.length)
    const victim = memberArray[randomIndex]

    console.log(`[RandomKick] Selected victim: ${victim.user.username} (${victim.id}) — voice channel id: ${victim.voice?.channelId ?? 'none'}`)

    const suspenseMessages = [
      t('randomkick.suspense1'),
      t('randomkick.suspense2'),
      t('randomkick.suspense3'),
      t('randomkick.suspense4'),
    ]

    const randomSuspenseMessage = suspenseMessages[Math.floor(Math.random() * suspenseMessages.length)]

    await message.channel.send(randomSuspenseMessage)

    // Wait 2 seconds for suspense
    await new Promise((resolve) => setTimeout(resolve, 2000))

    const farewellMessages = [
      t('randomkick.farewell1', { name: victim.displayName }),
      t('randomkick.farewell2', { name: victim.displayName }),
      t('randomkick.farewell3', { name: victim.displayName }),
      t('randomkick.farewell4', { name: victim.displayName }),
      t('randomkick.farewell5', { name: victim.displayName }),
    ]

    const randomFarewell = farewellMessages[Math.floor(Math.random() * farewellMessages.length)]

    try {
      console.log(`[RandomKick] Attempting to disconnect ${victim.user.username}...`)
      if (!victim.voice?.channel) {
        console.log(`[RandomKick] ERROR: victim has no voice channel (already left?)`)
        message.channel.send(t('randomkick.escaped', { name: victim.displayName }))
        return
      }
      await victim.voice.disconnect('Russian Roulette - randomckick')
      console.log(`[RandomKick] Successfully disconnected ${victim.user.username}`)
      message.channel.send(randomFarewell)
    } catch (error: any) {
      console.error(`[RandomKick] ERROR disconnecting ${victim.user.username}:`, error?.message ?? error)
      console.error(`[RandomKick] Full error:`, error)
      message.channel.send(t('randomkick.noPermission', { name: victim.displayName }))
    }
  }
}
