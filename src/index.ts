require('dotenv').config();

import Discord from'discord.js';
import axios from'axios';
import fs from 'fs';


const client = new Discord.Client();
const queue = new Map();

client.login(process.env.DISCORD_TOKEN);

client.on('ready', () => {
  console.log(`Logged in as ${client?.user?.tag}!`);
});

client.on('message', async message => {
  if (message.content.toLowerCase() === '!joke'.toLowerCase()) {
    const joke = await getNewJoke();

    message.reply(joke);
  }

  if (message.content.toLowerCase() === '!calabacon'.toLowerCase()) {
    message.member?.voice.channel?.join()
    .then(connection => {
      console.log('joined channel');

      const filePath = __dirname +'\\assets\\cala-bacon-fera.mp3';
      connection.play(fs.createReadStream(filePath))
      // When no packets left to send, leave the channel.

      setTimeout(() => {
      // connection.channel.leave();
      message.member?.voice.channel?.leave();

    }, 2000);
  })
  .catch(console.error);
    return;

  }
});

const getNewJoke = async (): Promise<string> =>  {
    const {data} = await axios.get('https://api.chucknorris.io/jokes/random');

    return data.value
}
