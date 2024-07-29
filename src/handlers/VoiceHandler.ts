import {
  AudioPlayer,
  AudioPlayerStatus,
  NoSubscriberBehavior,
  type VoiceConnection,
  VoiceConnectionStatus,
  createAudioPlayer,
  createAudioResource,
  getVoiceConnection,
  joinVoiceChannel,
} from '@discordjs/voice';
import type Discord from 'discord.js';
import * as mm from 'music-metadata';
import { DEFAULT_ASSET_PATH } from '../constants';
// import { QueueHandler } from './QueueHandler';

export class VoiceHandler {
  static connection: VoiceConnection | null | undefined = null
  static connectionChannelId: string | null | undefined = null
  static player: AudioPlayer | null | undefined = null
  static subscription: any
  static connectionIsReady = false;
  static playerStatus: AudioPlayerStatus | undefined

  static destroyConnection = () => {
    try {
      VoiceHandler.connection?.destroy()
      VoiceHandler.connection = undefined
      VoiceHandler.connectionChannelId = undefined
      VoiceHandler.connectionIsReady = false
    } catch (error) {
      console.log('DEBUG error on destroyConnection', error)
    }
  }

  static executeVoice = async (channel: Discord.VoiceBasedChannel, overrideFilePath?: string) => {
    try {
      const filePath = overrideFilePath || DEFAULT_ASSET_PATH

      const metadata = await mm.parseFile(filePath);
      const durationInMilliseconds = (metadata.format.duration || 0) * 1000;
      const channelId = channel?.id;

      if (VoiceHandler.connectionChannelId !== channelId && !!(channelId)) {
        VoiceHandler.destroyConnection();
      }

      if (!channelId) return;

      if (!VoiceHandler.connection) {
        VoiceHandler.connection = joinVoiceChannel({
          channelId: channel.id,
          guildId: channel.guild.id,
          adapterCreator: channel.guild.voiceAdapterCreator as any,
        })

        VoiceHandler.connectionChannelId = channel.id
      }

      const connection = VoiceHandler.connection

      if (!connection) {
        console.log('DEBUG no connection')
        return;
      };

      if (VoiceHandler.connectionIsReady) {
        VoiceHandler.playSound(filePath, durationInMilliseconds)
        return;
      }

      connection.on(VoiceConnectionStatus.Ready, () => {
        VoiceHandler.connectionIsReady = true;
        console.log(
          'The connection has entered the Ready state - ready to play audio!'
        )

        VoiceHandler.playSound(filePath, durationInMilliseconds)
      })

      connection.on(VoiceConnectionStatus.Disconnected, () => {
        VoiceHandler.destroyConnection();
      })

      connection.on(VoiceConnectionStatus.Destroyed, () => {
        VoiceHandler.destroyConnection();
      })


    } catch (error) {
      console.log('DEBUG error on executeVoice')
    }
  }

  static playSound = async (filePath: string, durationInMilliseconds: number) => {
    try {
      if (!VoiceHandler.player) {
        VoiceHandler.player = createAudioPlayer({
          behaviors: {
            noSubscriber: NoSubscriberBehavior.Pause,
          },
        })
      }

      // create a new player each time and execute it simultaneously?
      const player =  createAudioPlayer({
        behaviors: {
          noSubscriber: NoSubscriberBehavior.Pause,
        },
      })
      // const player = VoiceHandler.player

      if (!player) {
        console.log('DEBUG no player')
        return;
      }

      player.on(AudioPlayerStatus.Playing, () => {
        console.log('The audio player has started playing!')
      })

      player.on('error', (error) => {
        console.error(`Error: ${error.message} with resource`)
      })

      const resource = createAudioResource(filePath)
      console.log('DEBUG player play')
      player.play(resource)

      const connection = VoiceHandler.connection

      if (!connection) {
        console.log('DEBUG no connection')
        return;
      };

      // if (!VoiceHandler.subscription) {
      //   VoiceHandler.subscription = connection.subscribe(player)
      // }
      VoiceHandler.subscription?.unsubscribe()
      VoiceHandler.subscription = connection.subscribe(player)

      let timeout: NodeJS.Timeout

      // player.on('stateChange', (oldState, state) => {
      //   VoiceHandler.playerStatus = state.status;
      //   if (state.status === AudioPlayerStatus.Idle) {
      //     const queueHandler = new QueueHandler();
      //     const queueItem = queueHandler.dequeue();

      //     if (queueItem) {
      //       VoiceHandler.executeVoice(queueItem.channel, queueItem.filePath)
      //     }
      //   }
      // })

      // player.on('stateChange', (state) => {
      //   if (state.status === AudioPlayerStatus.Playing) {
      //     console.log('stateChange')

      //     const timeoutTime = durationInMilliseconds || 3000

      //     if (subscription && !timeout) {
      //       // if (timeout) clearTimeout(timeout)
      //       timeout = setTimeout(() => {
      //         console.log('clearing timeout')
      //         subscription.unsubscribe()
      //         if (
      //           connection.state.status !== VoiceConnectionStatus.Destroyed
      //         ) {
      //           // connection.destroy()
      //         }
      //       }, timeoutTime)
      //     }
      //   }
      // })
    }
    catch (error) {
      console.log('DEBUG error on playSound')
    }
  }
}
