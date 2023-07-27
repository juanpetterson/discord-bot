require('dotenv').config()

import axios from 'axios'
import Discord, { Client, Intents } from 'discord.js'
import fs from 'fs'
import {
  VoiceConnectionStatus,
  joinVoiceChannel,
  createAudioPlayer,
  NoSubscriberBehavior,
  createAudioResource,
  AudioPlayerStatus,
} from '@discordjs/voice'

import { keepAlive } from './server'

const gtts = require('gtts')
import AWS from 'aws-sdk'

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

    if (message.content === '!hi') {
      await getTextAsVoiceIA('hi')
      executeVoice(message)
    }

    if (message.content.toLowerCase().startsWith('%')) {
      const args = message.content.split(' ')
      await getTextAsVoiceIA(args.join('').replace('%', ''))
      executeVoice(message)
    }

    if (message.content.toLowerCase().startsWith('&')) {
      const args = message.content.split(' ')
      await getTextAsVoiceAWS(args.join('').replace('&', ''))
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
  try {
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
          // console.log('stateChange', state)

          const timeoutTime = state.playbackDuration || 3000

          if (subscription) {
            if (timeout) clearTimeout(timeout)
            // Unsubscribe after 5 seconds (stop playing audio on the voice connection)
            timeout = setTimeout(() => {
              console.log('clearing timeout')
              subscription.unsubscribe()
              if (connection.state.status !== VoiceConnectionStatus.Destroyed) {
                connection.destroy()
              }
            }, timeoutTime)
          }
        }
      })
    })
  } catch (error) {
    console.log('error on executeVoice')
  }
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

const getTextAsVoiceIA = async (text: string, language = 'pt-br') => {
  const data = {
    text,
    model_id: 'eleven_monolingual_v1',
    voice_settings: {
      stability: 0.5,
      similarity_boost: 0.5,
    },
  }

  try {
    const response = await axios.post(
      'https://api.elevenlabs.io/v1/text-to-speech/21m00Tcm4TlvDq8ikWAM',
      data,
      {
        headers: {
          'Content-Type': 'application/json',
          'xi-api-key': process.env.ELEVEN_TOKEN,
        },
        responseType: 'arraybuffer', // Ensure you receive the response as an ArrayBuffer
      }
    )

    const audioData = Buffer.from(response.data, 'binary').toString('base64')

    // Call the function to save the audio data to a file
    return saveAudioToFile(audioData, './src/assets/audios/speech.mp3')
  } catch (error: any) {
    console.error('Error fetching the audio:', error.message)
  }
}

const getTextAsVoiceAWS = async (text: string, language = 'pt-br') => {
  try {
    AWS.config.update({
      accessKeyId: process.env.AWS_ACCESS_KEY,
      secretAccessKey: process.env.AWS_SECRET_KEY,
      region: 'us-east-1', // Replace with your desired AWS region
    })

    const polly = new AWS.Polly({
      region: 'us-east-1', // Change this to your desired region
    })

    const params = {
      Text: text,
      OutputFormat: 'mp3', // e.g., 'mp3', 'ogg_vorbis', 'pcm', etc.
      VoiceId: 'Joanna', // e.g., 'Joanna', 'Matthew', 'Emma', etc. (see available voices below)
    }

    return polly
      .synthesizeSpeech(params, (err: any, data: any) => {
        if (err) {
          console.error('Error:', err)
          return false
        } else if (data.AudioStream instanceof Buffer) {
          // Process the audio stream (data.AudioStream) as per your requirement
          // For example, you can save the audio to a file or play it in the browser
          console.log('Audio generated successfully!')

          const audioData = Buffer.from(data.AudioStream, 'binary').toString(
            'base64'
          )

          // Call the function to save the audio data to a file
          saveAudioToFile(audioData, './src/assets/audios/speech.mp3')
          return true
        }
      })
      .promise()

    // const audioData = Buffer.from(response.data, 'binary').toString('base64')
    // // Call the function to save the audio data to a file
    // saveAudioToFile(audioData, './src/assets/audios/speech.mp3')
  } catch (error: any) {
    console.error('Error fetching the audio:', error.message)
  }
}

const saveAudioToFile = (audioData: any, fileName: string) => {
  const buffer = Buffer.from(audioData, 'base64')
  fs.writeFile(fileName, buffer, (err: any) => {
    if (err) {
      console.error('Error saving the audio to file:', err.message)
    } else {
      console.log('Audio saved to file:', fileName)
    }
  })
}

keepAlive()
client.login(process.env.DISCORD_TOKEN)
