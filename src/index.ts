require('dotenv').config()

import { Client, Intents, Message, MessageEmbed } from 'discord.js'
import heroes from './assets/data/heroes.json'

import { keepAlive } from './server'
import { CommandHandler } from './handlers/CommandHandler'
import { VoiceType } from './handlers/TextToVoiceHandler'

const COLORS_SCHEME = {
  0: 0x3071f7,
  1: 0x63f8bc,
  2: 0xbe00bb,
  3: 0xedeb09,
  4: 0xf46402,
}

const client = new Client({
  intents: [
    Intents.FLAGS.GUILDS,
    Intents.FLAGS.GUILD_MESSAGES,
    Intents.FLAGS.GUILD_MESSAGE_REACTIONS,
    Intents.FLAGS.GUILD_VOICE_STATES,
    Intents.FLAGS.DIRECT_MESSAGES,
  ],
})

client.once('clientReady', (c: any) => {
  console.log(`Ready! Logged in as ${c.user.tag}`)
})

client.on('messageCreate', async (message: Message) => {
  console.log('message received')
  try {
    const commandHandler = new CommandHandler()
    const messageContent = message.content.toLowerCase()

    if (messageContent.startsWith('!random')) {
      const args = messageContent.split(' ')
      const playerNames = args.slice(1)
      const randomCount = args[1]

      if (!randomCount && !playerNames.length) return

      if (!Number.isInteger(+randomCount)) {
        return randomizeHeroes(message, 0, playerNames)
      }

      return randomizeHeroes(message, +randomCount)
    }

    if (messageContent.startsWith('!')) {
      commandHandler.execute({ message, command: messageContent })
    }

    const VALID_VOICE_TYPES = ['%', '&', '$']
    // const VOICE_TYPE_TO_CHAR_MAP = new Map<'%' | '&' | '$', VoiceType>()
    const VOICE_TYPE_TO_CHAR_MAP = new Map<string, VoiceType>()
    VOICE_TYPE_TO_CHAR_MAP.set('%', VoiceType.IA)
    VOICE_TYPE_TO_CHAR_MAP.set('&', VoiceType.AWS)
    VOICE_TYPE_TO_CHAR_MAP.set('$', VoiceType.GTTS)

    const messageFirstChar = messageContent.charAt(0)

    if (!VALID_VOICE_TYPES.includes(messageFirstChar)) return

    const voiceType =
      VOICE_TYPE_TO_CHAR_MAP.get(messageFirstChar as any) || VoiceType.GTTS // TODO: fix TS

    const text = messageContent.substring(1)

    commandHandler.executeTextToVoice({
      message,
      text,
      voiceType,
    })
  } catch (error) {
    console.log(error)
  }

  // TODO move logic to a command handler
  if (message.content.toLowerCase() === '!langs'.toLowerCase()) {
    message.reply(`'af' : 'Afrikaans'
    'sq' : 'Albanian'
    'ar' : 'Arabic'
    'hy' : 'Armenian'
    'ca' : 'Catalan'
    'zh' : 'Chinese',
    'zh-cn' : 'Chinese (Mandarin/China)'
    'zh-tw' : 'Chinese (Mandarin/Taiwan)'
    'zh-yue' : 'Chinese (Cantonese)'
    'hr' : 'Croatian'
    'cs' : 'Czech'
    'da' : 'Danish'
    'nl' : 'Dutch'
    'en' : 'English'
    'en-au' : 'English (Australia)'
    'en-uk' : 'English (United Kingdom)'
    'en-us' : 'English (United States)'
    'eo' : 'Esperanto'
    'fi' : 'Finnish'
    'fr' : 'French'
    'de' : 'German'
    'el' : 'Greek'
    'ht' : 'Haitian Creole'
    'hi' : 'Hindi'
    'hu' : 'Hungarian'
    'is' : 'Icelandic'
    'id' : 'Indonesian'
    'it' : 'Italian'
    'ja' : 'Japanese'
    'ko' : 'Korean'
    'la' : 'Latin'
    'lv' : 'Latvian'
    'mk' : 'Macedonian'
    'no' : 'Norwegian'
    'pl' : 'Polish'
    'pt' : 'Portuguese'
    'pt-br' : 'Portuguese (Brazil)'
    'ro' : 'Romanian'
    'ru' : 'Russian'
    'sr' : 'Serbian'
    'sk' : 'Slovak'
    'es' : 'Spanish'
    'es-es' : 'Spanish (Spain)'
    'es-us' : 'Spanish (United States)'
    'sw' : 'Swahili'
    'sv' : 'Swedish'
    'ta' : 'Tamil'
    'th' : 'Thai'
    'tr' : 'Turkish'
    'vi' : 'Vietnamese'
    'cy' : 'Welsh'`)
  }
})

function getRandomHero(ignoreHeroes: Set<number> = new Set()) {
  const availableHeroes = heroes.filter((hero) => !ignoreHeroes.has(hero.id))
  const randomIndex = Math.floor(Math.random() * availableHeroes.length)
  const hero = availableHeroes[randomIndex]

  return hero
}

function randomizeHeroes(
  message: Message,
  count = 1,
  playerNames: string[] = []
) {
  const alreadyUsedHeroes = new Set<number>()
  const channel = message.channel

  const randomizedPlayers = playerNames.sort(() => Math.random() - 0.5)

  const maxRandom = playerNames?.length || Math.min(count, 5)

  for (let i = 0; i < maxRandom; i++) {
    const hero = getRandomHero(alreadyUsedHeroes)
    alreadyUsedHeroes.add(hero.id)

    const color: any = COLORS_SCHEME[i] || 0x3071f7

    const exampleEmbed = new MessageEmbed()
      .setColor(color) // update color based on dota team
      .setTitle(hero.localized_name)
      .setThumbnail(
        `https://cdn.cloudflare.steamstatic.com/apps/dota2/images/dota_react/heroes/${hero.name}.png`
      )

    // add joke after player name

    if (randomizedPlayers[i]) {
      exampleEmbed.setDescription(randomizedPlayers[i])
    }

    channel.send({ embeds: [exampleEmbed] })
  }
}

keepAlive()
client.login(process.env.DISCORD_TOKEN)
