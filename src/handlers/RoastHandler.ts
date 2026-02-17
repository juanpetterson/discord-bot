import { Message, EmbedBuilder, GuildMember } from 'discord.js'

const ROAST_TEMPLATES = [
  // General gaming roasts
  "{name} plays Dota like someone who learned from watching tutorial bots... and still failed.",
  "If feeding was an Olympic sport, {name} would have a gold medal collection.",
  "{name}'s MMR is so low, it's used as a negative example in math textbooks.",
  "I've seen better gameplay from a disconnected player than {name}.",
  "{name} said 'I'll carry' and proceeded to carry the enemy team to victory.",
  "{name}'s awareness is so bad, they wouldn't notice a Riki even if Riki was visible.",
  "Legend says {name} once pressed BKB after dying. True story.",
  "{name} buys wards like they're going out of fashion... oh wait, they never buy wards.",
  "Even bots report {name} for feeding.",
  "{name}'s Pudge hooks are so bad, Dendi cried watching them.",
  "{name} picked Invoker and used 2 spells the entire game. Both were ghost walk.",
  "{name}'s farm is so bad that even Anti-Mage with a Battle Fury would be impressed... at how little gold they have.",
  "When {name} plays support, the carry has to support them.",
  "{name} has the game sense of a creep. Actually, creeps have better pathing.",
  "{name}'s positioning is so bad, they stand in Macropyre to warm up.",
  "They say Dota is 5v5. When {name} plays, it's 4v6.",
  "{name} types 'GG EZ' after getting carried harder than a Divine Rapier.",
  "{name} blinked into 5 heroes and said 'where's my team?' My brother in Christ, you ARE the initiation.",
  "If {name} was a Dota item, they'd be an Iron Branch. Useful for nothing but stats padding.",
  "{name} ulted the creep wave and said 'calculated'.",
  "{name}'s reaction time is measured in geological periods.",
  "Watching {name} play is like watching a nature documentary — confused animal in an unfamiliar habitat.",
  "{name} has more deaths than a George R.R. Martin novel.",
  "{name}'s micro is so bad, they lose fights against their own illusions.",
  "{name} picked techies. That's the roast.",
  "{name}'s biggest contribution to the team is providing entertainment for the enemy.",

  // Dota-specific contextual roasts
  "The only thing {name} carries is disappointment.",
  "{name} said 'trust me I'm smurf' and then proceeded to go 0-12.",
  "{name}'s build path looks like they rolled dice in the shop.",
  "{name} went Battlefury on Io. They said it was 'a mood'.",
  "{name} has never seen the enemy ancient because they're always at the respawn fountain.",
  "If {name} was a hero, their ultimate would be 'Feed': passively gives gold to enemies.",
]

const ROAST_INTROS = [
  "🔥 **ROAST TIME** 🔥",
  "🎤 *clears throat* 🎤",
  "⚠️ **INCOMING ROAST** ⚠️",
  "🌶️ **SPICY ALERT** 🌶️",
  "💀 *Someone call an ambulance* 💀",
]

export class RoastHandler {
  static execute(message: Message) {
    // Get the mentioned user or use args
    const mention = message.mentions.members?.first()
    
    if (!mention) {
      message.reply('Usage: `!roast @user` — tag someone to roast them!')
      return
    }

    const targetName = mention.displayName || mention.user.username

    // Don't roast the bot
    if (mention.user.bot) {
      message.reply("Nice try, but you can't roast me. I'm the one doing the roasting here. 😎")
      return
    }

    const randomRoast = ROAST_TEMPLATES[Math.floor(Math.random() * ROAST_TEMPLATES.length)]
    const randomIntro = ROAST_INTROS[Math.floor(Math.random() * ROAST_INTROS.length)]
    const roastText = randomRoast.replace(/\{name\}/g, targetName)

    const embed = new EmbedBuilder()
      .setColor(0xff4500)
      .setTitle(randomIntro)
      .setDescription(roastText)
      .setFooter({ text: `Requested by ${message.author.username} | !roast @user` })

    message.channel.send({ embeds: [embed] })
  }
}
