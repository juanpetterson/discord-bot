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
  try {
    if (message.content.toLowerCase() === '!joke'.toLowerCase()) {
      const joke = await getNewJoke();

      message.reply(joke);
    }

    if (message.content.toLowerCase() === '!calabacon'.toLowerCase()) {
      message.member?.voice.channel?.join()
      .then(connection => {
        console.log('joined channel');

        setTimeout(() => {
          const filePath = './src/assets/audios/cala-bacon-fera.mp3';

          const hasFile = fs.existsSync(filePath);
          console.log(hasFile)

          connection.play(fs.createReadStream(filePath));
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

      let language = 'pt-br';

      const lastArg = args[args.length -1];
      const hasLanguageParam = lastArg.startsWith('<') && lastArg.endsWith('>')

      if (hasLanguageParam ) {
        language = lastArg.replace('<', '').replace('>', '');
        args.pop();
      }


      await getTextAsVoice(args.join(''), language);
      executeVoice(message);
    }

    if(message.content.toLowerCase().startsWith('!speech')) {

      const args = message.content.split(' ')
      args.shift();

      await getTextAsVoice(args.join(''), 'en');
      executeVoice(message);
    }
  } catch (error) {
    console.log(error)
  }

  if (message.content.toLowerCase() === '!langs'.toLowerCase()) {
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
    'cy' : 'Welsh'`);
  }
});

const getNewJoke = async (): Promise<string> =>  {
    const {data} = await axios.get('https://api.chucknorris.io/jokes/random');

    return data.value
}

const executeVoice = (message: Discord.Message) => {
    const filePath = './src/assets/audios/speech.mp3';
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

  await speech.save("./src/assets/audios/speech.mp3", (response: any) => {
    console.log(response)

    return true;
  })
}
