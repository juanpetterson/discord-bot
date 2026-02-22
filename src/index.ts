require('dotenv').config()

// Set FFmpeg path for discord.js voice BEFORE importing discord.js
// @ts-ignore
import ffmpegPath from 'ffmpeg-static';
const pathModule = require('path');

// Patch prism-media's FFmpeg detection
const prismMedia = require('prism-media');
if (ffmpegPath) {
  // Normalize the path to handle Windows paths correctly
  const normalizedPath = pathModule.normalize(ffmpegPath);
  console.log('FFmpeg path found:', normalizedPath);
  
  const originalGetInfo = prismMedia.FFmpeg.getInfo;
  prismMedia.FFmpeg.getInfo = function(force = false) {
    if (!force && prismMedia.FFmpeg._cachedInfo) {
      return prismMedia.FFmpeg._cachedInfo;
    }
    
    // Test if FFmpeg actually works
    const { spawnSync } = require('child_process');
    let output = 'FFmpeg static build';
    try {
      const result = spawnSync(normalizedPath, ['-version'], { windowsHide: true });
      if (result.stdout) {
        output = result.stdout.toString();
      }
    } catch (e) {
      console.error('FFmpeg test failed:', e);
    }
    
    const info = {
      command: normalizedPath,
      output: output,
      version: '4.4.1'
    };
    prismMedia.FFmpeg._cachedInfo = info;
    console.log('Returning patched FFmpeg info with command:', info.command);
    return info;
  };
}

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
  GuildMemberManager,
  VoiceState
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
import { MatchHandler } from './handlers/MatchHandler'
import { RandomKickHandler } from './handlers/RandomKickHandler'
import { VoteKickHandler } from './handlers/VoteKickHandler'
import { QuoteHandler } from './handlers/QuoteHandler'
import { RoastHandler } from './handlers/RoastHandler'
import { PollHandler } from './handlers/PollHandler'
import { BetHandler } from './handlers/BetHandler'
import { GroupHandler } from './handlers/GroupHandler'
import { ClipHandler } from './handlers/ClipHandler'

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

const USER_JOINED_CHANNEL_SOUNDS = {
  'carlesso2154': 'geral - trompete.mp3',
  'jacksonmajolo': 'geral - pode mamar.mp3',
  'gbonassina': 'gre - ó o je me empurrando.ogg',
  'cristiano.bonassina': 'cris - boooa gurizada.mp3',
  'eradim': 'rafiki - aiiiii gre.ogg',
  'wellfb': 'sido - ja tem tornado ja de novo.ogg',
  'dedableo': 'dw - um bilhao de dano.mp3',
  'juanpetterson.': 'binho - aiii rurrroor.ogg',
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

client.on(Events.VoiceStateUpdate, async (oldState: VoiceState, newState: VoiceState) => {
  const channel = client.channels.cache.get(newState.channelId || '') as any;
  const botChannel = client.channels.cache.get(VoiceHandler.connectionChannelId || '') as any;

  
  // Destroy connection when bot is alone in the channel
  if (botChannel) {
    const botChannelMembersNames = botChannel.members.map((member: GuildMember) => member.user.username);
    if (botChannel.members.size === 1 && botChannelMembersNames.includes('MACACKSOUND')) {
      VoiceHandler.destroyConnection();
    }
  }

  // Remove user from active group when they fully disconnect from voice
  if (oldState.channelId !== null && newState.channelId === null) {
    const userId = oldState.member?.id
    if (userId) {
      await GroupHandler.handleVoiceLeave(userId, client)
    }
  }

  if (oldState.channelId === null && newState.channelId !== null) {
    const user = newState.member?.user;
    if (user) {
      console.log(`${user.username} has joined the voice channel ${newState.channel?.name}`);
      const soundName = USER_JOINED_CHANNEL_SOUNDS[user.username as keyof typeof USER_JOINED_CHANNEL_SOUNDS];
      const fileExists = fs.existsSync(`./src/assets/uploads/${soundName}`);
      if (soundName && fileExists) {
        VoiceHandler.executeVoice(channel, `./src/assets/uploads/${soundName}`);
      }
    }
  }
});

client.on('messageCreate', async (message: Message) => {
  console.log('DEBUG message received')
  try {
    const commandHandler = new CommandHandler()
    const messageContent = message.content.toLowerCase()

    // ===== NEW FEATURES =====

    // Last Match Recap: !lastmatch [@user|nick]
    if (messageContent.startsWith('!lastmatch')) {
      const args = message.content.substring('!lastmatch'.length).trim()
      await MatchHandler.lastMatch(message, args)
      return
    }

    // Legacy: !match <steam_id>
    if (messageContent.startsWith('!match ')) {
      const steamId = message.content.split(' ').slice(1).join(' ').trim()
      if (steamId) {
        await MatchHandler.getLastMatch(message, steamId)
        return
      }
      message.reply('Usage: `!match <steam_id>`')
      return
    }

    // Russian Roulette: !randomkick
    if (messageContent === '!randomkick') {
      await RandomKickHandler.execute(message)
      return
    }

    // Vote Kick: !votekick <nickname>
    if (messageContent.startsWith('!votekick ')) {
      const targetName = message.content.substring('!votekick '.length).trim()
      if (targetName) {
        await VoteKickHandler.startVoteKick(message, targetName)
        return
      }
      message.reply('Usage: `!votekick <nickname>`')
      return
    }

    // Voice Clip: !clip - save last 60 seconds of voice chat
    if (messageContent === '!clip') {
      await ClipHandler.handleClip(message)
      return
    }

    // Vote Yes: !voteyes
    if (messageContent === '!voteyes') {
      await VoteKickHandler.voteYes(message)
      return
    }

    // Quotes: !addquote, !quote, !quotes, !delquote
    if (messageContent.startsWith('!addquote ')) {
      const args = message.content.substring('!addquote '.length)
      QuoteHandler.addQuote(message, args)
      return
    }

    if (messageContent === '!quote') {
      QuoteHandler.getRandomQuote(message)
      return
    }

    if (messageContent === '!quotes') {
      QuoteHandler.listQuotes(message)
      return
    }

    if (messageContent.startsWith('!delquote ')) {
      const quoteId = messageContent.split(' ')[1]
      QuoteHandler.deleteQuote(message, quoteId)
      return
    }

    // Roast Last Match: !roastlast [@user|nick]
    if (messageContent.startsWith('!roastlast')) {
      const args = message.content.substring('!roastlast'.length).trim()
      await RoastHandler.roastLastMatch(message, args)
      return
    }

    // Roast: !roast @user
    if (messageContent.startsWith('!roast')) {
      await RoastHandler.execute(message)
      return
    }

    // Poll: !poll, !vote, !endpoll
    if (messageContent.startsWith('!poll ')) {
      const args = message.content.substring('!poll '.length)
      await PollHandler.createPoll(message, args)
      return
    }

    if (messageContent.startsWith('!vote ')) {
      const voteArg = messageContent.split(' ')[1]
      PollHandler.vote(message, voteArg)
      return
    }

    if (messageContent === '!endpoll') {
      PollHandler.endPoll(message)
      return
    }

    // Bets: !bet @player nós|nos|eles, !betwin <matchId>, !cancelbet, !bets, !leaderboard, !balance
    if (messageContent.startsWith('!bet ') && !messageContent.startsWith('!betwin')) {
      const args = message.content.substring('!bet '.length)
      await BetHandler.placeBet(message, args)
      return
    }

    if (messageContent.startsWith('!betwin')) {
      const matchId = messageContent.split(' ')[1]
      await BetHandler.resolveByMatch(message, matchId)
      return
    }

    if (messageContent.startsWith('!cancelbet')) {
      await BetHandler.cancelBet(message)
      return
    }

    if (messageContent === '!bets') {
      BetHandler.showActiveBets(message)
      return
    }

    if (messageContent === '!leaderboard') {
      BetHandler.showLeaderboard(message)
      return
    }

    if (messageContent === '!balance') {
      BetHandler.checkBalance(message)
      return
    }

    // Auto group: !autox2 / !autox4 / !autox5
    if (messageContent.startsWith('!autox2') || messageContent.startsWith('!autox4') || messageContent.startsWith('!autox5')) {
      const size = messageContent.startsWith('!autox4') ? 4 : messageContent.startsWith('!autox5') ? 5 : 2
      await GroupHandler.autoGroup(message, size)
      return
    }

    // Group: !x2 / !x4 / !x5 start or join
    if (messageContent === '!x2' || messageContent === '!x4' || messageContent === '!x5') {
      const size = messageContent === '!x4' ? 4 : messageContent === '!x5' ? 5 : 2
      await GroupHandler.startOrJoin(message, size)
      return
    }

    // Leave group
    if (messageContent === '!x2leave' || messageContent === '!x4leave' || messageContent === '!x5leave') {
      await GroupHandler.leave(message)
      return
    }

    // Cancel group (creator only)
    if (messageContent === '!x2cancel' || messageContent === '!x4cancel' || messageContent === '!x5cancel') {
      GroupHandler.cancel(message)
      return
    }

    // Kick a member (creator only): !x2kick / !x4kick / !x5kick <name>
    if (messageContent.startsWith('!x2kick ') || messageContent.startsWith('!x4kick ') || messageContent.startsWith('!x5kick ')) {
      const spaceIdx = messageContent.indexOf(' ')
      const partialName = message.content.substring(spaceIdx + 1).trim()
      await GroupHandler.kick(message, partialName)
      return
    }

    // Help command
    if (messageContent === '!help') {
      const helpEmbed = new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle('🤖 Bot Commands')
        .addFields(
          { name: '🎵 Sound', value: '`!play <name>` — Play a sound\n`!sounds` — List sounds (slash)', inline: false },
          { name: '🎮 Dota 2', value: '`!random <count/players>` — Randomize heroes\n`!lastmatch [@user|nick]` — Last 10 match analysis\n`!match <steam_id>` — Last match recap (legacy)', inline: false },
          { name: '🔫 Kick', value: '`!randomckick` — Russian roulette (random kick)\n`!votekick <nick>` — Start a votekick\n`!voteyes` — Vote yes on active votekick', inline: false },
          { name: '🎙️ Clip', value: '`!clip` — Save the last 60 seconds of voice chat as MP3 + individual tracks ZIP', inline: false },
          { name: '💬 Quotes', value: '`!addquote "text" author` — Add a quote\n`!quote` — Random quote\n`!quotes` — List recent quotes\n`!delquote <id>` — Delete a quote', inline: false },
          { name: '🔥 Fun', value: '`!roast @user` — Roast someone (career stats)\n`!roastlast [@user|nick]` — Deep roast of last match (items, build, position)\n`!poll Question | Opt1 | Opt2` — Create poll\n`!vote <number>` — Vote on poll\n`!endpoll` — End active poll', inline: false },
          { name: '🎰 Bets', value: '`!bet @player nós` / `!bet @player eles` — Place a bet (nós=win, eles=lose)\n`!betwin <matchId>` — Resolve bets by match\n`!cancelbet @player` — Cancel your bet on that player\n`!bets` — Active bets\n`!leaderboard` — Points ranking\n`!balance` — Check your points', inline: false },
          { name: '🎮 x2/x4/x5', value: '`!x2` / `!x4` / `!x5` — Start or join a group manually\n`!autox2` / `!autox4` / `!autox5 [@skip1 @skip2]` — Auto-fill from voice channel (exclude @mentions)\n`!x2leave` / `!x4leave` / `!x5leave` — Leave group\n`!x2cancel` / `!x4cancel` / `!x5cancel` — Cancel group (creator)\n`!x2kick <nick>` / `!x4kick <nick>` / `!x5kick <nick>` — Kick member (creator)\n> Buttons: **🔀 Move to Channels** splits voice after teams are decided | **⚔️ Assign Heroes** assigns Dota 2 heroes', inline: false },
          { name: '🗣️ TTS', value: '`$text` — Google TTS\n`%text` — AI TTS\n`&text` — AWS TTS\n`!langs` — Supported languages', inline: false },
        )

      message.channel.send({ embeds: [helpEmbed] })
      return
    }

    // ===== EXISTING FEATURES =====

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

    if (messageContent.startsWith('!play')) {
      const args = messageContent.split(' ')
      const soundName = args.slice(1).join(' ')
      const sounds = fs.readdirSync('./src/assets/uploads')
      const soundFileName = sounds.find((sound) => sound.split('.')[0].includes(soundName))

      if (!soundFileName) return

      const channel = message.member?.voice?.channel

      if (!channel) return

      VoiceHandler.executeVoice(channel, `./src/assets/uploads/${soundFileName}`)
    }

    if (messageContent === '!langs') {
      return postSupportedLanguages(message)
    }

    if (messageContent === '!farm') {
      return postImage(message, 'binho-farm')
    }

    if (messageContent === '!boadw') {
      return postGIF(message, 'boadw')
    }

    if (messageContent === '!ué') {
      return postGIF(message, 'uejack')
    }

    if (messageContent === '!ué2') {
      return postGIF(message, 'uedw')
    }

    if (messageContent === '!combadw') {
      return postGIF(message, 'combadw')
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

  console.log('DEBUG interaction:', interaction.user.username)

  if (interactionName === 'upload') {
    const optionsAttachment: {url: string, name: string } = interaction.options.getAttachment('audio-file')
    const audioName = interaction.options.getString('name')
    const audioAutor = interaction.options.getString('autor')
    await downloadMP3(optionsAttachment, './src/assets/uploads', `${audioAutor}${PREFIX_SEPARATOR}${audioName}`);
    postAvailableSounds(interaction)
  }

  
  const isButtonInteraction = interaction.isButton()

  // Group buttons (join / random teams / random teams + heroes / assign heroes / split channels)
  if (isButtonInteraction && interaction.customId.startsWith('group_')) {
    await GroupHandler.handleButton(interaction)
    return
  }

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
  const sortedSounds = sounds.sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));

  const soundFileMaxNameSize = sounds.map((sound) => sound.split('.')[0]).reduce((max, current) => Math.max(max, current.length), 0)
  const prefixSounds: {
    [key: string]: string[]
  } = {}

  sortedSounds.forEach((sound, index) => {
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

function postImage(message: Message, imageName: string ) {
  const filePath = `./src/assets/images/${imageName}.png`
  const fileExists = fs.existsSync(filePath)

  if (!fileExists) return

  const image = filePath
  message.channel.send({ files: [image] })
}

function postGIF(message: Message, gifName: string ) {
  const filePath = `./src/assets/gifs/${gifName}.gif`
  const fileExists = fs.existsSync(filePath)

  if (!fileExists) return

  const image = filePath
  message.channel.send({ files: [image] })
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
