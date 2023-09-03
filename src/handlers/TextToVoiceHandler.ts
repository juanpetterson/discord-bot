const gtts = require('gtts')
import AWS from 'aws-sdk'
import fs from 'fs'
import axios from 'axios'
import { VoiceHandler } from './VoiceHandler'
import { Message } from 'discord.js'
import { ASSETS_PATH } from '../constants'

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
    const textToSpeechMap = {
      [VoiceType.GTTS]: this.getTextAsVoice,
      [VoiceType.IA]: this.getTextAsVoiceIA,
      [VoiceType.AWS]: this.getTextAsVoiceAWS,
    }
    const textToSpeech = textToSpeechMap[this.voiceType]

    if (!textToSpeech) return

    await textToSpeech(text, language)

    const voiceHandler = new VoiceHandler()
    voiceHandler.executeVoice(message)
  }

  getTextAsVoice = async (text: string, language = 'pt-br') => {
    const speech = new gtts(text, language)

    return speech.save('./src/assets/audios/speech.mp3')
  }

  getTextAsVoiceIA = async (text: string, language = 'pt-br') => {
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

      return this.saveAudioToFile(audioData)
    } catch (error: any) {
      console.error('Error fetching the audio:', error.message)
    }
  }

  getTextAsVoiceAWS = async (text: string, language = 'pt-br') => {
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

            this.saveAudioToFile(audioData)
            return true
          }
        })
        .promise()
    } catch (error: any) {
      console.error('Error fetching the audio:', error.message)
    }
  }

  private saveAudioToFile = (
    audioData: any,
    fileName = `${ASSETS_PATH}/speech.mp3`
  ) => {
    const buffer = Buffer.from(audioData, 'base64')
    fs.writeFile(fileName, buffer, (err: any) => {
      if (err) {
        console.error('Error saving the audio to file:', err.message)
      } else {
        console.log('Audio saved to file:', fileName)
      }
    })
  }
}
