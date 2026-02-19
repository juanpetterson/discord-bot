import { Message, EmbedBuilder, GuildMember } from 'discord.js'
import { DISCORD_TO_STEAM } from './BetHandler'
import { MatchHandler } from './MatchHandler'
import { t, LANG } from '../i18n'
import { askGemini, roastPrompt } from '../ai'

//  Generic roast pools (fallback when no Steam data) 

const GENERIC_ROASTS_PTBR = [
  '{name} joga Dota como algu�m que aprendeu pelo tutorial do bot e ainda reprovou.',
  'Se feeding fosse Olimp�ada, {name} j� teria uma prateleira cheia de ouros.',
  'O MMR de {name} � t�o baixo que � usado como exemplo negativo em aula de matem�tica.',
  'J� vi gameplay melhor de um jogador desconectado do que de {name}.',
  '{name} disse "eu carry" e carregou o time inimigo pra vit�ria.',
  'A consci�ncia de {name} � t�o ruim que n�o perceberia um Riki mesmo se ele estivesse vis�vel.',
  'Lenda diz que {name} um dia usou BKB depois de morrer. Hist�ria real.',
  '{name} compra ward como se estivesse saindo de moda... ah espera, {name} nunca compra ward.',
  'At� bots reportam {name} por feeding.',
  '{name} pegou Invoker e usou 2 skills durante todo o jogo. As duas foram Ghost Walk.',
  '"Quando {name} joga suporte, o carry tem que suportar {name}."',
  'O farm de {name} � t�o ruim que at� um Anti-Mage sem BFury ficaria impressionado com o quanto voc� n�o farmou.',
  '{name} tem a consci�ncia de situa��o de uma creep. Na verdade, creeps t�m melhor pathfinding.',
  'O posicionamento de {name} � t�o ruim que fica no Macropyre pra se aquecer.',
  'Dizem que Dota � 5v5. Quando {name} joga, fica 4v6.',
  '{name} faz blink em 5 her�is e pergunta "cad� meu time?" Meu irm�o em Cristo, VOC� era a inicia��o.',
  'Se {name} fosse um item do Dota, seria um Iron Branch. �til s� pra encher espa�o.',
  '{name} deu ultimate na wave de creeps e disse "calculado".',
  'O tempo de rea��o de {name} � medido em per�odos geol�gicos.',
  'Assistir {name} jogar � como assistir um document�rio de natureza  animal confuso em habitat desconhecido.',
  '{name} tem mais mortes que um livro do George R.R. Martin.',
  '{name} pegou Techies. Esse � o roast.',
  'A maior contribui��o de {name} pro time � entreter os inimigos.',
  '{name} foi 0/12 e disse que era smurf. Filho, smurfs GANHAM.',
  'Se {name} fosse um her�i, o ultimate dele seria "Feed": d� ouro passivamente pro inimigo.',
]

const GENERIC_ROASTS_ENUS = [
  '{name} plays Dota like someone who learned from watching tutorial bots... and still failed.',
  'If feeding was an Olympic sport, {name} would have a gold medal collection.',
  "{name}'s MMR is so low, it's used as a negative example in math class.",
  "I've seen better gameplay from a disconnected player than {name}.",
  "{name} said 'I'll carry' and proceeded to carry the enemy team to victory.",
  "{name}'s awareness is so bad, they wouldn't notice a Riki even if Riki was visible.",
  "Legend says {name} once pressed BKB after dying. True story.",
  "{name} buys wards like they're going out of fashion... oh wait, they never buy wards.",
  'Even bots report {name} for feeding.',
  "{name} picked Invoker and used 2 spells the entire game. Both were Ghost Walk.",
  "When {name} plays support, the carry has to support them.",
  "{name}'s farm is so bad that even Anti-Mage would be impressed... at how little gold you have.",
  "{name} has the game sense of a creep. Actually, creeps have better pathing.",
  "{name}'s positioning is so bad, they stand in Macropyre to warm up.",
  "They say Dota is 5v5. When {name} plays, it's 4v6.",
  "{name} blinked into 5 heroes and said 'where's my team?' My brother in Christ, you ARE the initiation.",
  "If {name} was a Dota item, they'd be an Iron Branch. Useful for nothing but stats padding.",
  "{name} ulted the creep wave and said 'calculated'.",
  "{name}'s reaction time is measured in geological periods.",
  "Watching {name} play is like watching a nature documentary  confused animal in unfamiliar habitat.",
  '{name} has more deaths than a George R.R. Martin novel.',
  '{name} picked Techies. That is the roast.',
  "The only contribution {name} makes to the team is entertaining the enemy.",
  "{name} said 'trust me I'm a smurf' and then proceeded to go 0-12.",
  "If {name} was a hero, their ultimate would be 'Feed': passively gives gold to enemies.",
]

//  Data-driven roast pools 

function dataRoastPtBr(
  name: string,
  wins: number, total: number,
  avgDeaths: number,
  avgKDA: number,
  favHero: string,
  streak: number,
  worstDeaths: number,
  feedGames: number
): string {
  const winRate = Math.round((wins / total) * 100)
  const lines: string[] = []

  if (streak <= -5)
    lines.push(`${Math.abs(streak)} derrotas seguidas. ${name} entrou no Dota em modo autom�tico de destrui��o de MMR.`)
  else if (streak >= 5)
    lines.push(`Ironicamente, ${name} est� em ${streak} vit�rias seguidas. N�o merece, mas n�o d� pra negar.`)

  if (winRate <= 25)
    lines.push(`${winRate}% de winrate nos �ltimos ${total} jogos. ${name} est� literalmente a pagar MMR alheio.`)
  else if (winRate >= 75)
    lines.push(`${winRate}% de winrate nas ultimas ${total} partidas. Isso seria impressionante se n�o fosse suspeito.`)

  if (avgDeaths >= 12)
    lines.push(`M�dia de ${avgDeaths} mortes por jogo. ${name} n�o � um jogador, � um evento de respawn.`)
  else if (avgDeaths >= 8)
    lines.push(`${avgDeaths} mortes por jogo em m�dia. ${name} est� distribuindo ouro com a generosidade de uma ONG.`)

  if (avgKDA < 1)
    lines.push(`KDA m�dio de ${avgKDA}. ${name} atrapalha mais do que contribui  matematicamente comprovado.`)
  else if (avgKDA >= 5)
    lines.push(`KDA m�dio de ${avgKDA}. E ainda assim o time perde �s vezes. O que diz sobre os colegas de ${name}.`)

  if (feedGames >= 3)
    lines.push(`Deu 10+ mortes em ${feedGames} das �ltimas ${total} partidas. Isso � padr�o, n�o acidente.`)

  if (worstDeaths >= 20)
    lines.push(`O recorde pessoal de ${name} � ${worstDeaths} mortes numa partida. N�o tem emoji pra isso.`)

  if (favHero)
    lines.push(`Her�i favorito: ${favHero}. O ${favHero} viu isso e pediu transfer�ncia.`)

  if (lines.length === 0)
    lines.push(`${name} � t�o med�ocre no Dota que nem d� pra zoar direito. Isso � triste de uma forma diferente.`)

  return lines.join('\n')
}

function dataRoastEnUs(
  name: string,
  wins: number, total: number,
  avgDeaths: number,
  avgKDA: number,
  favHero: string,
  streak: number,
  worstDeaths: number,
  feedGames: number
): string {
  const winRate = Math.round((wins / total) * 100)
  const lines: string[] = []

  if (streak <= -5)
    lines.push(`${Math.abs(streak)}-loss streak. ${name} has entered automatic self-destruct mode on the MMR ladder.`)
  else if (streak >= 5)
    lines.push(`Ironically, ${name} is on a ${streak}-win streak. Doesn't deserve it, but can't deny facts.`)

  if (winRate <= 25)
    lines.push(`${winRate}% winrate over the last ${total} games. ${name} is literally working as unpaid help for the enemy team's ranked climb.`)
  else if (winRate >= 75)
    lines.push(`${winRate}% winrate over ${total} games. Impressive, if it weren't so suspicious.`)

  if (avgDeaths >= 12)
    lines.push(`Average of ${avgDeaths} deaths per game. ${name} isn't a player  they're a respawn event.`)
  else if (avgDeaths >= 8)
    lines.push(`${avgDeaths} deaths per game on average. ${name} distributes gold with the generosity of a charity.`)

  if (avgKDA < 1)
    lines.push(`Average KDA of ${avgKDA}. ${name} hurts the team more than they help  mathematically proven.`)
  else if (avgKDA >= 5)
    lines.push(`Average KDA of ${avgKDA}. And the team still loses sometimes. Says something about ${name}'s teammates.`)

  if (feedGames >= 3)
    lines.push(`Had 10+ deaths in ${feedGames} of the last ${total} games. That's not bad luck, that's a pattern.`)

  if (worstDeaths >= 20)
    lines.push(`Personal record: ${worstDeaths} deaths in a single game. There is no emoji for this.`)

  if (favHero)
    lines.push(`Favourite hero: ${favHero}. The hero itself would request a transfer.`)

  if (lines.length === 0)
    lines.push(`${name} is so mediocre at Dota there's nothing even worth roasting. That's a different kind of sad.`)

  return lines.join('\n')
}

//  Handler 

export class RoastHandler {
  static async execute(message: Message) {
    const mention = message.mentions.members?.first()

    if (!mention) {
      message.reply(t('roast.usage'))
      return
    }

    if (mention.user.bot) {
      message.reply(t('common.botCannotRoast'))
      return
    }

    const targetName = mention.displayName || mention.user.username
    const steamId = DISCORD_TO_STEAM[mention.user.username]

    //  No Steam ID: generic roast (AI-generated if available, else pool fallback) 
    if (!steamId) {
      const genericPrompt = LANG === 'pt-br'
        ? `Você é um comediante de roast savage de Dota 2. Escreva 3-4 linhas de piadas sobre um jogador chamado ${targetName} que provavelmente é ruim no Dota. Use humor brasileiro, seja específico e criativo. Sem cabeçalhos, sem markdown, só texto.`
        : `You are a savage Dota 2 roast comedian. Write 3-4 roast lines about a player named ${targetName} who is probably bad at Dota. Be specific and creative. No headers, no markdown, plain text only.`
      const pool = LANG === 'pt-br' ? GENERIC_ROASTS_PTBR : GENERIC_ROASTS_ENUS
      const poolFallback = pool[Math.floor(Math.random() * pool.length)].replace(/\{name\}/g, targetName)
      const roast = (await askGemini(genericPrompt)) ?? poolFallback

      const embed = new EmbedBuilder()
        .setColor(0xff4500)
        .setTitle(t('roast.title'))
        .setDescription(roast)
        .setFooter({ text: t('roast.footer', { requester: message.author.username }) })

      await message.channel.send({ embeds: [embed] })
      await message.channel.send(t('roast.noSteam', { name: targetName }))
      return
    }

    //  Has Steam ID: fetch real stats 
    await message.channel.send(t('roast.fetching', { name: targetName }))
    await (message.channel as any).sendTyping?.()

    // Convert Steam64  Steam32 if needed
    let accountId = steamId
    if (steamId.length >= 17)
      accountId = (BigInt(steamId) - BigInt('76561197960265728')).toString()

    const agg = await MatchHandler.fetchAggregate(accountId, 10)

    const embed = new EmbedBuilder()
      .setColor(0xff4500)
      .setTitle(t('roast.title'))
      .setFooter({ text: t('roast.footer', { requester: message.author.username }) })

    if (!agg) {
      // Fallback to generic if fetch failed
      const pool = LANG === 'pt-br' ? GENERIC_ROASTS_PTBR : GENERIC_ROASTS_ENUS
      const roast = pool[Math.floor(Math.random() * pool.length)].replace(/\{name\}/g, targetName)
      embed.setDescription(roast)
    } else {
      const aiPrompt = roastPrompt({
        lang: LANG,
        name: targetName,
        wins: agg.wins, total: agg.total,
        avgDeaths: agg.avgDeaths,
        avgKDA: agg.avgKDA,
        favHero: agg.favouriteHero,
        streak: agg.currentStreak,
        worstDeaths: agg.worstDeathsGame,
        feedGames: agg.totalFeedGames,
      })

      const hardcodedFallback = LANG === 'pt-br'
        ? dataRoastPtBr(
            targetName,
            agg.wins, agg.total,
            agg.avgDeaths, agg.avgKDA,
            agg.favouriteHero,
            agg.currentStreak,
            agg.worstDeathsGame,
            agg.totalFeedGames
          )
        : dataRoastEnUs(
            targetName,
            agg.wins, agg.total,
            agg.avgDeaths, agg.avgKDA,
            agg.favouriteHero,
            agg.currentStreak,
            agg.worstDeathsGame,
            agg.totalFeedGames
          )

      const roastText = (await askGemini(aiPrompt)) ?? hardcodedFallback

      embed
        .setDescription(roastText)
        .addFields(
          { name: ' Stats reais', value: `${agg.wins}W/${agg.total - agg.wins}L nos �ltimos ${agg.total} jogos`, inline: true },
          { name: ' Mortes/jogo', value: `${agg.avgDeaths}`, inline: true },
          { name: ' KDA m�dio', value: `${agg.avgKDA}`, inline: true },
        )
    }

    await message.channel.send({ embeds: [embed] })
  }
}
