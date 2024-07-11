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
import { get } from 'http';

export class VoiceHandler {
  static connection: VoiceConnection | null | undefined = null
  static player: AudioPlayer | null | undefined = null
  static subscription: any
  static connectionIsReady = false;

  static executeVoice = async (channel: Discord.VoiceBasedChannel, overrideFilePath?: string) => {
    try {
      const filePath = overrideFilePath || DEFAULT_ASSET_PATH

      console.log('DEBUG filePath', filePath)
      
      const metadata = await mm.parseFile(filePath);
      const durationInMilliseconds = (metadata.format.duration || 0) * 1000;

      // const channel =
      //   message.member?.voice.channel || ({} as Discord.VoiceBasedChannel)

      VoiceHandler.connection = getVoiceConnection(channel.guild.id)

      if (!VoiceHandler.connection) {
        VoiceHandler.connection = joinVoiceChannel({
          channelId: channel.id,
          guildId: channel.guild.id,
          adapterCreator: channel.guild.voiceAdapterCreator as any,
        })
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
