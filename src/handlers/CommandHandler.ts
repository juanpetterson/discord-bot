import fs from 'fs'
import { ASSETS_PATH } from '../constants'
import { VoiceHandler } from './VoiceHandler'
import { Message } from 'discord.js'
import { TextToVoiceHandler, VoiceType } from './TextToVoiceHandler'

const commandsMap = new Map<string, string>()
commandsMap.set('calabacon', 'cala-bacon-fera.mp3')
commandsMap.set('ench', 'ench.mp3')
commandsMap.set('ready', 'ready.mp3')
commandsMap.set('binhomajolo', 'binho-majolo.mp3')
commandsMap.set('binhoafiliado', 'binho-afiliar.mp3')
commandsMap.set('morri', 'morri.mp3')
commandsMap.set('morri2', 'morri2.mp3')

type CommandProps = {
  message: Message
  command: string
}

type TextTovVoiceProps = {
  message: Message
  text: string
  voiceType?: VoiceType
  language?: string
}

export class CommandHandler {
  async execute({ message, command }: CommandProps) {
    const assetName = commandsMap.get(command.replace('!', ''))
    const filePath = `${ASSETS_PATH}/${assetName}`

    if (!filePath || !fs.existsSync(filePath)) return

    const voiceHandler = new VoiceHandler()
    voiceHandler.executeVoice(message, filePath)
  }

  async executeTextToVoice({
    message,
    text,
    voiceType = VoiceType.GTTS,
  }: TextTovVoiceProps) {
    let language = 'pt-br'

    if (voiceType === VoiceType.GTTS) {
      const args = message.content.split(' ')

      const lastArg = args[args.length - 1]
      const hasLanguageParam = lastArg.startsWith('<') && lastArg.endsWith('>')

      if (hasLanguageParam) {
        language = lastArg.replace('<', '').replace('>', '')
        args.pop()
      }

      text = args.join(' ').replace('$', '')
    }

    const textToVoiceHandler = new TextToVoiceHandler(voiceType)
    await textToVoiceHandler.execute(message, text, language)
  }
}
