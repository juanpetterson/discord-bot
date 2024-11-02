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
  Events,
  GuildMember,
  GuildMemberManager
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
// import { QueueHandler } from './handlers/QueueHandler';

import { calculateTextWidth } from './utils'

const MAX_COMPONENTS_COUNT = 5;
const MAX_COMPONENTS_ROW_COLUMN_COUNT = MAX_COMPONENTS_COUNT * MAX_COMPONENTS_COUNT;
const PREFIX_SEPARATOR = ' - '

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

// client.on(Events.VoiceStateUpdate, (oldState: any, newState: any) => {
//   const channel = client.channels.cache.get(VoiceHandler.connectionChannelId || '') as any;

//   if (!channel) return;

//   const membersNames = channel.members.map((member: GuildMember) => member.user.username);

//   // Check if the user has left the channel
//   if (oldState.channelId && !newState.channelId) {
//     console.log(`${oldState.member?.user.username} has left the channel`);
//   }

//   // Check if the user has joined the channel
//   if (!oldState.channelId && newState.channelId) {
//     console.log(`${newState.member?.user.username} has joined the channel`);
//   }

//   if (channel.members.size === 1 && membersNames.includes('MACACKSOUND')) {
//     VoiceHandler.destroyConnection();
//   }

//   // Execute trompete sound file when the members size increase
//   if (channel.members.size === 1 && membersNames.includes('MACACKSOUND')) {
//     VoiceHandler.executeVoice(channel, './src/assets/uploads/geral - trompete.mp3');
//   }

//   const oldStateMembers = (oldState.guild?.members as GuildMemberManager).cache.map((member) => member.user.username);
//   const newStateMembers = (newState.guild?.members as GuildMemberManager).cache.map((member) => member.user.username);

//   console.log('DEBUG oldState channelId:', oldState.channelId);
//   console.log('DEBUG newState channelId:', newState.channelId);
//   console.log('DEBUG oldState members:', oldStateMembers);
//   console.log('DEBUG newState members:', newStateMembers);
// });

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
  const interactionName = interaction?.commandName
  const messageInteractionName = interaction?.message?.interaction?.commandName
  
  if (interactionName === 'upload') {
    const optionsAttachment: {url: string, name: string } = interaction.options.getAttachment('audio-file')
    const audioName = interaction.options.getString('name')
    const audioAutor = interaction.options.getString('autor')
    await downloadMP3(optionsAttachment, './src/assets/uploads', `${audioAutor}${PREFIX_SEPARATOR}${audioName}`);
    postAvailableSounds(interaction)
  }

  
  const isButtonInteraction = interaction.isButton()

  if (messageInteractionName === 'sounds' || isButtonInteraction) {
    // ready file names from the assets/uploads folder
    VoiceHandler.player?.play

    const channel =
    interaction.member?.voice?.channel || ({} as VoiceBasedChannel)

    if (!channel) {
      console.log('DEBUG no channel')
      return;
    }

    const filePath = `./src/assets/uploads/${interaction.customId}`
    // const queueHandler = new QueueHandler();
    
    // if (VoiceHandler.playerStatus === 'playing' || VoiceHandler.playerStatus === 'buffering') {
    //   queueHandler.add({ channel: channel, filePath })
    // } else {
      VoiceHandler.executeVoice(channel, filePath)
    // }

    interaction.deferUpdate('Playing sound!')
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
    postAvailableSounds(interaction)
  }

  if (interaction.commandName === 'delete') {
    const deleteFileName = interaction.options.getString('name')
    const sounds = fs.readdirSync('./src/assets/uploads')
    const soundFileName = sounds.find((sound) => sound.split('.')[0] === deleteFileName)


    // remove file by name
    fs.unlinkSync(`./src/assets/uploads/${soundFileName}`)
    postAvailableSounds(interaction)
  }
})

async function postAvailableSounds(interaction) {
  const buttonStyles = [ButtonStyle.Primary,  ButtonStyle.Danger, ButtonStyle.Secondary, ButtonStyle.Success]
  let styleIndex = 0
  const sounds = fs.readdirSync('./src/assets/uploads')

  const soundFileMaxNameSize = sounds.map((sound) => sound.split('.')[0]).reduce((max, current) => Math.max(max, current.length), 0)
  const prefixSounds: {
    [key: string]: string[]
  } = {}

  sounds.forEach((sound, index) => {
    const prefixExists = sound.indexOf(PREFIX_SEPARATOR) !== -1
    const prefix = prefixExists ? sound.split(PREFIX_SEPARATOR)[0] : 'geral'

    if (!prefixSounds[prefix]) {
      prefixSounds[prefix] = []
    }

    prefixSounds[prefix].push(sound)
  })


  const prefixButtons: {
    [key: string]: ButtonBuilder[]
  } = {};



  Object.entries(prefixSounds).forEach(([prefix, sounds]) => {
    if (styleIndex >= buttonStyles.length) {
      styleIndex = 0
    }

    sounds.forEach((sound, index) => {
      let label = sound.split('.')[0]
      label = label.split(PREFIX_SEPARATOR)[1] || label
      const leftSize = Math.floor((soundFileMaxNameSize - label.length ) / 2)
      const completeCharacter = 'ㅤ'
      
      let buttonName = label.padStart(((leftSize / 2) + label.length), completeCharacter);
      buttonName = buttonName.padEnd(soundFileMaxNameSize - leftSize, completeCharacter);
          
      const button = new ButtonBuilder()
        .setCustomId(sound)
        .setLabel(`${buttonName}`)
        .setStyle(buttonStyles[styleIndex])
  
      if (!prefixButtons[prefix]) {
        prefixButtons[prefix] = []
      }

      prefixButtons[prefix].push(button)
    })

    styleIndex++;
  })

  async function processButtons() {
    for (const [index, prefix] of Object.keys(prefixButtons).entries()) {
      const buttons = prefixButtons[prefix];
      const row = new ActionRowBuilder();
      const rows = [row];
      let previousButtonPrefix = '';
  
      buttons.forEach((button, index) => {
        const buttonData: { custom_id: string } = button.data;
        const buttonPrefixExists = buttonData.custom_id.indexOf(PREFIX_SEPARATOR) !== -1;
        const buttonPrefix = buttonPrefixExists ? button.data.custom_id.split(PREFIX_SEPARATOR)[0] : 'geral';
  
        console.log('DEBUG buttons sound', buttonPrefix, buttonPrefixExists);
        if (index % MAX_COMPONENTS_COUNT === 0 && index !== 0 || (previousButtonPrefix !== buttonPrefix && previousButtonPrefix !== '')) {
          rows.push(new ActionRowBuilder());
        }
  
        rows[rows.length - 1].addComponents(button);
        previousButtonPrefix = buttonPrefix;
      });
  
      await replyAvailableSounds(rows, interaction, index > 0, prefix || 'geral');
    }
  }
  
  processButtons();
  

}

async function replyAvailableSounds(rows: ActionRowBuilder[], interaction: Interaction, alreadyReply = false, prefix = '', isSamePrefix = false) {
  const currentRows = rows.splice(0, 5)

  // const rowCustomId = currentRows?.[0].components[0].data.custom_id

  // console.log('DEBUG replyAvailableSounds', rowCustomId)

  if (alreadyReply) {
    console.log('DEBUG followUp', rows.length, alreadyReply)
    if (!isSamePrefix) {
      interaction.channel?.send({ content: prefix, components: ([...currentRows.map(row => row.toJSON())]) as any })
    } else {
      interaction.channel?.send({ components: ([...currentRows.map(row => row.toJSON())]) as any })
    }
  } else {
    console.log('DEBUG reply', rows.length, alreadyReply)
    
    await interaction.reply({
      content: prefix,
      components: [...currentRows]
    })
  }

  if (rows.length > 0) {
    // call the function again with the remaining rows
    replyAvailableSounds(rows, interaction, true, prefix, true)
  }
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

    exampleEmbed.setDescription(`Extra ${i + 1}`)

    embedMessages.push(exampleEmbed)
  }

  channel?.send({ embeds: embedMessages })
}

// Function to download the MP3 file
async function downloadMP3(attachment:  {url: string, name: string }, destinationFolder: string, audioName: string) {
  // Ensure the destination folder exists
  if (!fs.existsSync(destinationFolder)) {
    fs.mkdirSync(destinationFolder, { recursive: true });
  }
  const { url, name } = attachment
  const fileFormat = name.split('.').pop();
  const fileNameNew = `${audioName}.${fileFormat}`;
  const destinationPath = path.join(destinationFolder, fileNameNew);

  return new Promise((resolve, reject) => {
    https.get(url, (response) => {
      // Check if the request was successful
      if (response.statusCode === 200) {
        const fileStream = fs.createWriteStream(destinationPath);
        response.pipe(fileStream);
  
        fileStream.on('finish', () => {
          fileStream.close();
          console.log('Download completed:', destinationPath);
        });
        resolve('Download completed');
      } else {
        console.error('Failed to download file:', response.statusCode);
        reject(new Error('Failed to download file'));
      }
    }).on('error', (err) => {
      console.error('Error downloading the file:', err.message);
      reject(err);
    });
  })
}

keepAlive()
// registerCommands()
client.login(process.env.DISCORD_TOKEN)
