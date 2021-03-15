require('dotenv').config();

import Discord from'discord.js';
import axios from'axios';

const client = new Discord.Client();

client.login(process.env.DISCORD_TOKEN);

client.on('ready', () => {
  console.log(`Logged in as ${client?.user?.tag}!`);
});

client.on('message', async msg => {
  if (msg.content.toLowerCase() === '!joke'.toLowerCase()) {
    const joke = await getNewJoke();

    msg.reply(joke);
  }
});

const getNewJoke = async (): Promise<string> =>  {
    const {data} = await axios.get('https://api.chucknorris.io/jokes/random');

    return data.value
}
