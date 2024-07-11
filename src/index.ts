require('dotenv').config()

import {
  Client,
  GatewayIntentBits,
  Partials,
  Message,
  EmbedBuilder,
  CacheType,
  Interaction,
  ButtonBuilder,
  ButtonStyle,
  ChatInputCommandInteraction,
  ActionRowBuilder,
  VoiceBasedChannel,
} from 'discord.js'
import fs from 'fs'
import https from 'https';
import path from 'path';
import heroes from './assets/data/heroes.json'

import { keepAlive } from './server'
import { CommandHandler } from './handlers/CommandHandler'
import { VoiceType } from './handlers/TextToVoiceHandler'

import { registerCommands } from './register-commands'
import { VoiceHandler } from './handlers/VoiceHandler'
import { createAudioResource } from '@discordjs/voice'

const COLORS_SCHEME = {
  0: 0x3071f7,
  1: 0x63f8bc,
  2: 0xbe00bb,
  3: 0xedeb09,
  4: 0xf46402,
}

const COLORS_SCHEME_EXTRA = {
  0: 0xff0000,
  1: 0x00ff00,
  2: 0x0000ff,
}

export const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Channel],
})

client.once('clientReady', (c: any) => {
  console.log(`Ready! Logged in as ${c.user.tag}`)
})

client.on('custom-message', (message: string) => {
  const channel = client.channels.cache.get('1003668690052587623') as any

  if (!channel) return

  channel.send(message)
})

client.on('messageCreate', async (message: Message) => {
  console.log('DEBUG message received')
  try {
    const commandHandler = new CommandHandler()
    const messageContent = message.content.toLowerCase()

    if (messageContent.startsWith('!random')) {
      const args = messageContent.split(' ')
      const playerNames = args.slice(1)
      const randomCount = args[1]

      if (!randomCount && !playerNames.length) return

      if (!Number.isInteger(+randomCount)) {
        console.log('DEBUG randomizeHeroes players')
        return randomizeHeroes(message, 0, playerNames)
      }

      console.log('DEBUG randomizeHeroes count')
      return randomizeHeroes(message, +randomCount)
    }

    if (messageContent === '!langs') {
      return postSupportedLanguages(message)
    }

    if (messageContent.startsWith('!') && messageContent !== '!langs') {
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
})

client.on('interactionCreate', async (interaction) => {
  const optionsAttachment = interaction.options?._hoistedOptions?.[1]?.attachment
  
  if (optionsAttachment?.url) {
    const audioName = interaction.options?._hoistedOptions?.[0].value
    downloadMP3(optionsAttachment.url, './src/assets/uploads', audioName);
    interaction.reply('Sound uploaded!')
  }

  const interactionName = interaction?.message?.interaction?.commandName

  if (interactionName === 'sounds') {
    // ready file names from the assets/uploads folder
    const sounds = fs.readdirSync('./src/assets/uploads')
    console.log( 'DEBUG interactionCreate sounds', interaction.customId)
    console.log( 'DEBUG interactionCreate sounds', sounds)

    VoiceHandler.player?.play

    const channel =
    interaction.member?.voice?.channel || ({} as VoiceBasedChannel)

    if (!channel) {
      console.log('DEBUG no channel')
      return;
    }

    const resource = createAudioResource(`./src/assets/uploads/${sounds[0]}`)
    const filePath = `./src/assets/uploads/${interaction.customId}`
    VoiceHandler.executeVoice(channel, filePath)
    interaction.reply('Playing sound')
    // VoiceHandler.player?.play(resource)
  }

  if (!interaction.isChatInputCommand() ) return

  if (interaction.commandName === 'random') {
    await interaction.reply('------- Randomized Heroes -------')
    const player1 = interaction.options.getString('player-1')
    const player2 = interaction.options.getString('player-2')
    const player3 = interaction.options.getString('player-3')
    const player4 = interaction.options.getString('player-4')
    const player5 = interaction.options.getString('player-5')
    const count = interaction.options.getInteger('count') || ''

    const players = [player1, player2, player3, player4, player5].filter(
      (player) => !!player
    ) as string[]

    if (!count && !players) return

    if (players.length > 0) {
      return randomizeHeroes(interaction, 0, players)
    }

    if (Number.isInteger(+count)) {
      return randomizeHeroes(interaction, +count)
    }
  }

  if (interaction.commandName === 'embed') {
    const channel = interaction.channel

    await interaction.reply('-')
    const author = interaction.options.getString('author')
    const title = interaction.options.getString('title')
    const description = interaction.options.getString('description')
    const image = interaction.options.getString('image')
    const color = interaction.options.getString('color') || null
    // const player4 = interaction.options.getString('player-4')

    const exampleEmbed = new EmbedBuilder()

    if (author) {
      exampleEmbed.setAuthor({
        name: author,
      })
    }

    if (title) {
      exampleEmbed.setTitle(title)
    }

    if (description) {
      exampleEmbed.setDescription(description)
    }

    if (image) {
      exampleEmbed.setImage(image)
    }

    if (color) {
      exampleEmbed.setColor(color as any)
    }

    channel?.send({ embeds: [exampleEmbed] })
  }

  if (interaction.commandName === 'sounds') {
    // await interaction.reply('Available sounds')
    postAvailableSounds(interaction)
  }
})

async function postAvailableSounds(interaction) {
  const sounds = fs.readdirSync('./src/assets/uploads')

  const buttons = sounds.map((sound) => {
    const label = sound.split('.')[0]

    return new ButtonBuilder()
      .setCustomId(sound)
      .setLabel(label)
      .setStyle(ButtonStyle.Primary)
  })

  const row = new ActionRowBuilder()
    .addComponents([...buttons]);

  await interaction.reply({
    content: `Available sounds:`,
    components: [row],
  });
}

function postSupportedLanguages(message: Message) {
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

export function getRandomHero(ignoreHeroes: Set<number> = new Set()) {
  const availableHeroes = heroes.filter((hero) => !ignoreHeroes.has(hero.id))
  const randomIndex = Math.floor(Math.random() * availableHeroes.length)
  const hero = availableHeroes[randomIndex]

  return hero
}

export function randomizeHeroes(
  message: Message | Interaction<CacheType>,
  count = 1,
  playerNames: string[] = []
) {
  const alreadyUsedHeroes = new Set<number>()
  const channel = message.channel

  const randomizedPlayers = playerNames.sort(() => Math.random() - 0.5)

  const maxRandom = playerNames?.length || Math.min(count, 5)
  const embedMessages = []

  for (let i = 0; i < maxRandom; i++) {
    const hero = getRandomHero(alreadyUsedHeroes)
    alreadyUsedHeroes.add(hero.id)

    const color: any = COLORS_SCHEME[i] || 0x3071f7

    const exampleEmbed = new EmbedBuilder()
      .setColor(color) // update color based on dota team
      .setTitle(hero.localized_name)
      .setThumbnail(
        `https://cdn.cloudflare.steamstatic.com/apps/dota2/images/dota_react/heroes/${hero.name}.png`
      )

    // add joke after player name

    if (randomizedPlayers[i]) {
      exampleEmbed.setDescription(randomizedPlayers[i])
    }

    embedMessages.push(exampleEmbed)
  }

  for (let i = 0; i < 3; i++) {
    const hero = getRandomHero(alreadyUsedHeroes)
    alreadyUsedHeroes.add(hero.id)

    const color: any = COLORS_SCHEME_EXTRA[i] || 0x3071f7

    const exampleEmbed = new EmbedBuilder()
      .setColor(color) // update color based on dota team
      .setTitle(hero.localized_name)
      .setThumbnail(
        `https://cdn.cloudflare.steamstatic.com/apps/dota2/images/dota_react/heroes/${hero.name}.png`
      )

    // add joke after player name

    exampleEmbed.setDescription(`Extra ${i + 1}`)

    embedMessages.push(exampleEmbed)
  }

  channel?.send({ embeds: embedMessages })
}

// Function to download the MP3 file
function downloadMP3(url: string, destinationFolder: string, fileName?: string) {
  // Ensure the destination folder exists
  if (!fs.existsSync(destinationFolder)) {
    fs.mkdirSync(destinationFolder, { recursive: true });
  }

  const fileNameNew = fileName ? `${fileName}.mp3` : path.basename(url);
  const destinationPath = path.join(destinationFolder, fileNameNew);

  https.get(url, (response) => {
    // Check if the request was successful
    if (response.statusCode === 200) {
      const fileStream = fs.createWriteStream(destinationPath);
      response.pipe(fileStream);

      fileStream.on('finish', () => {
        fileStream.close();
        console.log('Download completed:', destinationPath);
      });
    } else {
      console.error('Failed to download file:', response.statusCode);
    }
  }).on('error', (err) => {
    console.error('Error downloading the file:', err.message);
  });
}

keepAlive()
// registerCommands()
client.login(process.env.DISCORD_TOKEN)
