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
]

// Construct and prepare an instance of the REST module
const guildId = process.env.GUILD_ID
const clientId = process.env.CLIENT_ID
const rest = new REST().setToken(
  'ODIwNzgyMjY0NTU5NDY4NTY3.GTL5_8.MM5YqAwzWrRb0pSPnf5FEYhJ8hFLCyJMdmF5NA'
)

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
