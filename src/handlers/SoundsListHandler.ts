import fs from 'fs'
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  Guild,
} from 'discord.js'

const PREFIX_SEPARATOR = ' - '
const SOUNDS_DIR = './src/assets/uploads'

/**
 * Pick a channel for posting the sounds list:
 * 1. If the trigger channel name contains "sounds", post there.
 * 2. Otherwise, find the first text channel in the guild whose name contains "sounds".
 * 3. If no such channel exists, return null (caller should skip posting).
 */
export function findSoundsChannel(guild: Guild | null | undefined, currentChannel: any): any | null {
  const nameOf = (ch: any) => (ch?.name || '').toLowerCase()

  if (currentChannel && nameOf(currentChannel).includes('sounds')) {
    return currentChannel
  }

  if (!guild) return null

  const match = guild.channels.cache.find(
    (ch: any) =>
      ch.type === ChannelType.GuildText && nameOf(ch).includes('sounds')
  )
  return match || null
}

/**
 * Post the available-sounds button list (same UI as `/sounds`) to a specific channel.
 * Sends one message per prefix group, splitting into batches of up to 5 rows.
 */
export async function postAvailableSoundsToChannel(channel: any): Promise<void> {
  if (!channel?.send) return
  if (!fs.existsSync(SOUNDS_DIR)) return

  const buttonStyles = [
    ButtonStyle.Primary,
    ButtonStyle.Danger,
    ButtonStyle.Secondary,
    ButtonStyle.Success,
  ]
  const sounds = fs.readdirSync(SOUNDS_DIR).sort((a, b) =>
    a.toLowerCase().localeCompare(b.toLowerCase())
  )
  if (sounds.length === 0) return

  const maxNameLen = sounds
    .map((s) => s.split('.')[0])
    .reduce((max, cur) => Math.max(max, cur.length), 0)

  const prefixSounds: { [prefix: string]: string[] } = {}
  for (const sound of sounds) {
    const prefix = sound.includes(PREFIX_SEPARATOR)
      ? sound.split(PREFIX_SEPARATOR)[0]
      : 'geral'
    if (!prefixSounds[prefix]) prefixSounds[prefix] = []
    prefixSounds[prefix].push(sound)
  }

  const padChar = 'ㅤ'
  let styleIndex = 0

  for (const [prefix, group] of Object.entries(prefixSounds)) {
    if (styleIndex >= buttonStyles.length) styleIndex = 0
    const style = buttonStyles[styleIndex++]

    const buttons = group.map((sound) => {
      let label = sound.split('.')[0]
      label = label.split(PREFIX_SEPARATOR)[1] || label
      const leftSize = Math.floor((maxNameLen - label.length) / 2)
      let buttonName = label.padStart(leftSize / 2 + label.length, padChar)
      buttonName = buttonName.padEnd(maxNameLen - leftSize, padChar)
      return new ButtonBuilder()
        .setCustomId(sound)
        .setLabel(buttonName)
        .setStyle(style)
    })

    // Chunk into rows of 5 buttons, then chunk rows into messages of 5 rows
    const rows: ActionRowBuilder<ButtonBuilder>[] = []
    for (let i = 0; i < buttons.length; i += 5) {
      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        buttons.slice(i, i + 5)
      )
      rows.push(row)
    }

    let isFirstBatch = true
    while (rows.length > 0) {
      const batch = rows.splice(0, 5)
      try {
        await channel.send({
          content: isFirstBatch ? prefix : undefined,
          components: batch,
        })
      } catch (err) {
        console.error('SoundsListHandler: send failed', err)
        return
      }
      isFirstBatch = false
    }
  }
}
