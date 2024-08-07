const gtts = require('gtts')
// import AWS from 'aws-sdk'
import axios from 'axios'
import { Message, VoiceBasedChannel } from 'discord.js'
import fs from 'fs'
import { ASSETS_PATH } from '../constants'
import { VoiceHandler } from './VoiceHandler'

export enum VoiceType {
  AWS = 'aws',
  IA = 'ia',
  GTTS = 'gtts',
}

export class TextToVoiceHandler {
  voiceType = VoiceType.GTTS

  constructor(voiceType?: VoiceType) {
    this.voiceType = voiceType || VoiceType.GTTS
  }

  execute = async (message: Message, text: string, language = 'pt-br') => {
    const channel =
        message.member?.voice.channel || ({} as VoiceBasedChannel)

    const textToSpeechMap = {
      [VoiceType.GTTS]: this.getTextAsVoice,
      [VoiceType.IA]: this.getTextAsVoiceIA,
      [VoiceType.AWS]: this.getTextAsVoiceAWS,
    }

    const textToSpeech = textToSpeechMap[this.voiceType]

    if (!textToSpeech) return

    const filePath = await textToSpeech(text, language)

    console.log('DEBUG filePath', filePath)

    if (!filePath) return;
    
    // const voiceHandler = new VoiceHandler()
    VoiceHandler.executeVoice(channel)
  }

  getTextAsVoice = async (text: string, language = 'pt-br') => {
    console.log('DEBUG GTTS')
    try {
      const speech = new gtts(text, language)

      return new Promise((resolve, reject) => {
        speech.save('./src/assets/audios/speech.mp3', (e) => {
          if (e) {
            console.log('DEBUG GTTS Error saving the audio:', e.message)
            reject('')
          }
  
          resolve('./src/assets/audios/speech.mp3')
          console.log('DEBUG GTTS Audio saved to file:', './src/assets/audios/speech.mp3')
        })
      })
      
    } catch (error: any) {
      console.log('DEBUG GTTS Error fetching the audio:', error.message)
      if (`${error.message}`.includes('Language not supported') ) {
        const speech = new gtts('Linguagem errada seu 🐊 e 🐞', 'es')

        return speech.save('./src/assets/audios/speech.mp3')
      }
    }
  }

  getTextAsVoiceIA = async (text: string, language = 'pt-br') => {
    console.log('DEBUG IA')
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
        'https://api.elevenlabs.io/v1/text-to-speech/7p1Ofvcwsv7UBPoFNcpI',
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

      return this.saveAudioToFile(audioData)
    } catch (error: any) {
      console.log('DEBUG Error fetching the audio:', error.message)
      return ''
    }
  }

  getTextAsVoiceAWS = async (text: string, language = 'pt-br') => {
    // try {
    //   AWS.config.update({
    //     accessKeyId: process.env.AWS_ACCESS_KEY,
    //     secretAccessKey: process.env.AWS_SECRET_KEY,
    //     region: 'us-east-1', // Replace with your desired AWS region
    //   })
    //   const polly = new AWS.Polly({
    //     region: 'us-east-1', // Change this to your desired region
    //   })
    //   const params = {
    //     Text: text,
    //     OutputFormat: 'mp3', // e.g., 'mp3', 'ogg_vorbis', 'pcm', etc.
    //     VoiceId: 'Joanna', // e.g., 'Joanna', 'Matthew', 'Emma', etc. (see available voices below)
    //   }
    //   return polly
    //     .synthesizeSpeech(params, (err: any, data: any) => {
    //       if (err) {
    //         console.error('Error:', err)
    //         return false
    //       } else if (data.AudioStream instanceof Buffer) {
    //         // Process the audio stream (data.AudioStream) as per your requirement
    //         // For example, you can save the audio to a file or play it in the browser
    //         console.log('DEBUG Audio generated successfully!')
    //         const audioData = Buffer.from(data.AudioStream, 'binary').toString(
    //           'base64'
    //         )
    //         this.saveAudioToFile(audioData)
    //         return true
    //       }
    //     })
    //     .promise()
    // } catch (error: any) {
    //   console.error('Error fetching the audio:', error.message)
    // }
  }

  private saveAudioToFile = async (
    audioData: any,
    fileName = `${ASSETS_PATH}/speech.mp3`
  ) => {
    const buffer = Buffer.from(audioData, 'base64')

    return new Promise((resolve, reject) => {
      fs.writeFile(fileName, buffer, (err: any) => {
        if (err) {
          console.log('DEBUG Error saving the audio to file:', err.message)
          resolve('')
        } else {
          console.log('DEBUG Audio saved to file:', fileName)
          resolve(fileName)
        }
      })
    })
  }
}
