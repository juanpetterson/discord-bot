require('dotenv').config();

import Discord from'discord.js';
import axios from'axios';
import fs from 'fs';
const gtts = require('gtts');

const client = new Discord.Client();

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

      setTimeout(() => {
        const filePath = '..\\assets\\cala-bacon-fera.mp3';
        connection.play(fs.createReadStream(filePath), {volume: 1.0});
      }, 2000);

      // When no packets left to send, leave the channel.
      setTimeout(() => {
      connection.channel.leave();
      }, 4000);
    })
  .catch(console.error);
    return;

  }

  if(message.content.toLowerCase().startsWith('!falar')) {

    const args = message.content.split(' ')
    args.shift();

    await getTextAsVoice(args.join(''));
    await executeVoice(message);
  }

  if(message.content.toLowerCase().startsWith('!speech')) {

    const args = message.content.split(' ')
    args.shift();

    await getTextAsVoice(args.join(''), 'en');
    await executeVoice(message);
  }
});

const getNewJoke = async (): Promise<string> =>  {
    const {data} = await axios.get('https://api.chucknorris.io/jokes/random');

    return data.value
}

const executeVoice = (message: Discord.Message) => {
    const filePath = 'speech.mp3';
    message.member?.voice.channel?.join().then(connection => {
      connection.play(fs.createReadStream(filePath));

      setTimeout(() => {
        connection.channel.leave();

        return true;

      }, 3000);
    });
}

const getTextAsVoice = async (text: string, language = 'pt-br') => {
  const speech = new gtts(text, language);

  await speech.save("speech.mp3", (response: any) => {
    console.log(response)

    return true;
  })
}
