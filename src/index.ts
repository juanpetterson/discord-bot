require('dotenv').config()

import Discord, { Client, Intents } from 'discord.js'
import axios from 'axios'
import fs from 'fs'
const gtts = require('gtts')
import {
  VoiceConnectionStatus,
  generateDependencyReport,
  joinVoiceChannel,
  createAudioPlayer,
  NoSubscriberBehavior,
  createAudioResource,
  AudioPlayerStatus,
} from '@discordjs/voice'

console.log(generateDependencyReport())

const client = new Client({
  intents: [
    Intents.FLAGS.GUILDS,
    Intents.FLAGS.GUILD_MESSAGES,
    Intents.FLAGS.GUILD_MESSAGE_REACTIONS,
    Intents.FLAGS.GUILD_VOICE_STATES,
  ],
})

client.once('clientReady', (c: any) => {
  console.log(`Ready! Logged in as ${c.user.tag}`)

  setInterval(() => {
    console.log('ping')
  }, 1000 * 60 * 5)
})

client.on('messageCreate', async (message: any) => {
  console.log('message received')
  try {
    if (message.content.toLowerCase() === '!calabacon'.toLowerCase()) {
      const filePath = './src/assets/audios/cala-bacon-fera.mp3'

      executeVoice(message, filePath)
    }

    if (message.content.toLowerCase() === '!ench'.toLowerCase()) {
      const filePath = './src/assets/audios/ench.mp3'

      executeVoice(message, filePath)
    }

    if (message.content.toLowerCase() === '!ready'.toLowerCase()) {
      const filePath = './src/assets/audios/ready.mp3'

      executeVoice(message, filePath)
    }

    if (message.content === '!fg') {
      await getTextAsVoice('para de putaria')
      executeVoice(message)
    }

    if (message.content.toLowerCase().startsWith('$')) {
      const args = message.content.split(' ')

      let language = 'pt-br'

      const lastArg = args[args.length - 1]
      const hasLanguageParam = lastArg.startsWith('<') && lastArg.endsWith('>')

      if (hasLanguageParam) {
        language = lastArg.replace('<', '').replace('>', '')
        args.pop()
      }

      await getTextAsVoice(args.join('').replace('$', ''), language)
      executeVoice(message)
    }

    if (message.content.toLowerCase().startsWith('!speech')) {
      const args = message.content.split(' ')
      args.shift()

      await getTextAsVoice(args.join(''), 'en')
      executeVoice(message)
    }
  } catch (error) {
    console.log(error)
  }

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

const executeVoice = (message: Discord.Message, overrideFilePath?: string) => {
  const filePath = overrideFilePath || './src/assets/audios/speech.mp3'

  const channel =
    message.member?.voice.channel || ({} as Discord.VoiceBasedChannel)

  const connection = joinVoiceChannel({
    channelId: channel.id,
    guildId: channel.guild.id,
    adapterCreator: channel.guild.voiceAdapterCreator as any,
  })

  connection.on(VoiceConnectionStatus.Ready, () => {
    console.log(
      'The connection has entered the Ready state - ready to play audio!'
    )

    const player = createAudioPlayer({
      behaviors: {
        noSubscriber: NoSubscriberBehavior.Pause,
      },
    })

    player.on(AudioPlayerStatus.Playing, () => {
      console.log('The audio player has started playing!')
    })

    player.on('error', (error) => {
      console.error(`Error: ${error.message} with resource`)
    })

    const resource = createAudioResource(filePath)
    player.play(resource)

    const subscription = connection.subscribe(player)

    let timeout: NodeJS.Timeout

    player.on('stateChange', (state) => {
      if (state.status === AudioPlayerStatus.Playing) {
        console.log('stateChange', state)

        const timeoutTime = state.playbackDuration || 3000

        if (subscription) {
          if (timeout) clearTimeout(timeout)
          // Unsubscribe after 5 seconds (stop playing audio on the voice connection)
          timeout = setTimeout(() => {
            subscription.unsubscribe()
            connection.disconnect()
          }, timeoutTime)
        }
      }
    })
  })
}

const getTextAsVoice = async (text: string, language = 'pt-br') => {
  const speech = new gtts(text, language)

  return await speech.save(
    './src/assets/audios/speech.mp3',
    (response: any) => {
      return true
    }
  )
}

client.login(process.env.DISCORD_TOKEN)
