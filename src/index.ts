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
        const filePath = __dirname +'\\assets\\cala-bacon-fera.mp3';
        connection.play(fs.createReadStream(filePath))

      }, 2000);

      // When no packets left to send, leave the channel.

      setTimeout(() => {
      // connection.channel.leave();
      message.member?.voice.channel?.leave();

    }, 4000);
  })
  .catch(console.error);
    return;

  }

  if(message.content.toLowerCase().startsWith('!speech')) {

    const args = message.content.split(' ')
    args.shift();

    getTextAsVoice(args.join(''));

    setTimeout(() => {
      const filePath = __dirname +'\\speech.mp3';
      console.log(filePath);
      message.member?.voice.channel?.join().then(connection =>
      connection.play(fs.createReadStream(filePath)))

    }, 5000);

    setTimeout(() => {
      // connection.channel.leave();
      message.member?.voice.channel?.leave();

    }, 8000);
  }
});

const getNewJoke = async (): Promise<string> =>  {
    const {data} = await axios.get('https://api.chucknorris.io/jokes/random');

    return data.value
}

const getTextAsVoice = async (text: string) => {
  const speech = new gtts(text, 'pt-br');

  speech.save("./src/speech.mp3", (response: any) => {
    // res.download('outpout.mp3')
    console.log(response)

  })

  // console.log(response)
}
