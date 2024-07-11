require('dotenv').config()

// import { SlashCommandBuilder } from '@discordjs/builders'

import { REST, Routes } from 'discord.js'

const commands = [
  {
    name: 'random',
    description: 'Randomize heroes',
    options: [
      {
        name: 'player-1',
        type: 3,
        description: 'Player name',
        required: false,
      },
      {
        name: 'player-2',
        type: 3,
        description: 'Player name',
        required: false,
      },
      {
        name: 'player-3',
        type: 3,
        description: 'Player name',
        required: false,
      },
      {
        name: 'player-4',
        type: 3,
        description: 'Player name',
        required: false,
      },
      {
        name: 'player-5',
        type: 3,
        description: 'Player name',
        required: false,
      },
      {
        name: 'count',
        type: 4,
        description: 'Number of heroes',
        required: false,
      },
    ],
  },
  {
    name: 'embed',
    description: 'Send Embed Message',
    options: [
      {
        name: 'author',
        type: 3,
        description: 'Autor',
        required: false,
      },
      {
        name: 'title',
        type: 3,
        description: 'Título',
        required: false,
      },
      {
        name: 'description',
        type: 3,
        description: 'Descrição',
        required: false,
      },
      {
        name: 'image',
        type: 3,
        description: 'URL da imagem',
        required: false,
      },
      {
        name: 'color',
        type: 3,
        description: 'Cor do embed',
        required: false,
      },
      {
        name: 'count',
        type: 4,
        description: 'Number of heroes',
        required: false,
      },
    ],
  },
  {
    name: 'sounds',
    description: 'List available sound on the bot',
  },
  {
    name: 'upload',
    description: 'Upload sound',
    options: [
      {
        name: 'name',
        type: 3,
        description: 'Sound name',
        required: true,
      },
      {
        name: 'audio-file',
        type: 11,
        description: 'Audio file',
        required: true
      }
    ]
  },
]

// Construct and prepare an instance of the REST module
const guildId = process.env.GUILD_ID || '' // load from server usage
const clientId = process.env.CLIENT_ID || ''
const rest = new REST().setToken(process.env.DISCORD_TOKEN || '')

// and deploy your commands!
export const registerCommands = async () => {
  try {
    console.log(
      `Started refreshing ${commands.length} application (/) commands.`
    )

    // The put method is used to fully refresh all commands in the guild with the current set
    const data: any = await rest.put(
      Routes.applicationGuildCommands(clientId, guildId),
      { body: commands }
    )

    console.log(
      `Successfully reloaded ${data.length} application (/) commands.`
    )
  } catch (error) {
    // And of course, make sure you catch and log any errors!
    console.error(error)
  }
}
