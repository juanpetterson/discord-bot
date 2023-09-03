import Discord from 'discord.js'
import {
  VoiceConnectionStatus,
  joinVoiceChannel,
  createAudioPlayer,
  NoSubscriberBehavior,
  createAudioResource,
  AudioPlayerStatus,
} from '@discordjs/voice'
import { DEFAULT_ASSET_PATH } from '../constants'

export class VoiceHandler {
  executeVoice = (message: Discord.Message, overrideFilePath?: string) => {
    try {
      const filePath = overrideFilePath || DEFAULT_ASSET_PATH

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
                if (
                  connection.state.status !== VoiceConnectionStatus.Destroyed
                ) {
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
}
