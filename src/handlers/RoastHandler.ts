import { Message, EmbedBuilder, GuildMember } from 'discord.js'
import { DISCORD_TO_STEAM, fetchDotaNick } from './BetHandler'
import { MatchHandler, LastMatchFull } from './MatchHandler'
import { t, LANG } from '../i18n'
import { askAI, roastPrompt, roastLastMatchPrompt } from '../ai'

//  Generic roast pools (fallback when no Steam data) 

const GENERIC_ROASTS_PTBR = [
  '{name} joga Dota como algu\ufffdm que aprendeu pelo tutorial do bot e ainda reprovou.',
  'Se feeding fosse Olimp\ufffdada, {name} j\ufffd teria uma prateleira cheia de ouros.',
  'O MMR de {name} \ufffd t\ufffdo baixo que \ufffd usado como exemplo negativo em aula de matem\ufffdtica.',
  'J\ufffd vi gameplay melhor de um jogador desconectado do que de {name}.',
  '{name} disse "eu carry" e carregou o time inimigo pra vit\ufffdria.',
  'A consci\ufffdncia de {name} \ufffd t\ufffdo ruim que n\ufffdo perceberia um Riki mesmo se ele estivesse vis\ufffdvel.',
  'Lenda diz que {name} um dia usou BKB depois de morrer. Hist\ufffdria real.',
  '{name} compra ward como se estivesse saindo de moda... ah espera, {name} nunca compra ward.',
  'At\ufffd bots reportam {name} por feeding.',
  '{name} pegou Invoker e usou 2 skills durante todo o jogo. As duas foram Ghost Walk.',
  '"Quando {name} joga suporte, o carry tem que suportar {name}."',
  'O farm de {name} \ufffd t\ufffdo ruim que at\ufffd um Anti-Mage sem BFury ficaria impressionado com o quanto voc\ufffd n\ufffdo farmou.',
  '{name} tem a consci\ufffdncia de situa\ufffd\ufffdo de uma creep. Na verdade, creeps t\ufffdm melhor pathfinding.',
  'O posicionamento de {name} \ufffd t\ufffdo ruim que fica no Macropyre pra se aquecer.',
  'Dizem que Dota \ufffd 5v5. Quando {name} joga, fica 4v6.',
  '{name} faz blink em 5 her\ufffdis e pergunta "cad\ufffd meu time?" Meu irm\ufffdo em Cristo, VOC\ufffd era a inicia\ufffd\ufffdo.',
  'Se {name} fosse um item do Dota, seria um Iron Branch. \ufffdtil s\ufffd pra encher espa\ufffdo.',
  '{name} deu ultimate na wave de creeps e disse "calculado".',
  'O tempo de rea\ufffd\ufffdo de {name} \ufffd medido em per\ufffdodos geol\ufffdgicos.',
  'Assistir {name} jogar \ufffd como assistir um document\ufffdrio de natureza  animal confuso em habitat desconhecido.',
  '{name} tem mais mortes que um livro do George R.R. Martin.',
  '{name} pegou Techies. Esse \ufffd o roast.',
  'A maior contribui\ufffd\ufffdo de {name} pro time \ufffd entreter os inimigos.',
  '{name} foi 0/12 e disse que era smurf. Filho, smurfs GANHAM.',
  'Se {name} fosse um her\ufffdi, o ultimate dele seria "Feed": d\ufffd ouro passivamente pro inimigo.',
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
    lines.push(`${Math.abs(streak)} derrotas seguidas. ${name} entrou no Dota em modo autom\ufffdtico de destrui\ufffd\ufffdo de MMR.`)
  else if (streak >= 5)
    lines.push(`Ironicamente, ${name} est\ufffd em ${streak} vit\ufffdrias seguidas. N\ufffdo merece, mas n\ufffdo d\ufffd pra negar.`)

  if (winRate <= 25)
    lines.push(`${winRate}% de winrate nos \ufffdltimos ${total} jogos. ${name} est\ufffd literalmente a pagar MMR alheio.`)
  else if (winRate >= 75)
    lines.push(`${winRate}% de winrate nas ultimas ${total} partidas. Isso seria impressionante se n\ufffdo fosse suspeito.`)

  if (avgDeaths >= 12)
    lines.push(`M\ufffddia de ${avgDeaths} mortes por jogo. ${name} n\ufffdo \ufffd um jogador, \ufffd um evento de respawn.`)
  else if (avgDeaths >= 8)
    lines.push(`${avgDeaths} mortes por jogo em m\ufffddia. ${name} est\ufffd distribuindo ouro com a generosidade de uma ONG.`)

  if (avgKDA < 1)
    lines.push(`KDA m\ufffddio de ${avgKDA}. ${name} atrapalha mais do que contribui  matematicamente comprovado.`)
  else if (avgKDA >= 5)
    lines.push(`KDA m\ufffddio de ${avgKDA}. E ainda assim o time perde \ufffds vezes. O que diz sobre os colegas de ${name}.`)

  if (feedGames >= 3)
    lines.push(`Deu 10+ mortes em ${feedGames} das \ufffdltimas ${total} partidas. Isso \ufffd padr\ufffdo, n\ufffdo acidente.`)

  if (worstDeaths >= 20)
    lines.push(`O recorde pessoal de ${name} \ufffd ${worstDeaths} mortes numa partida. N\ufffdo tem emoji pra isso.`)

  if (favHero)
    lines.push(`Her\ufffdi favorito: ${favHero}. O ${favHero} viu isso e pediu transfer\ufffdncia.`)

  if (lines.length === 0)
    lines.push(`${name} \ufffd t\ufffdo med\ufffdocre no Dota que nem d\ufffd pra zoar direito. Isso \ufffd triste de uma forma diferente.`)

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

//  Hardcoded roast-last-match fallbacks (used when AI is unavailable) 

function roastLastFallbackPtBr(name: string, d: LastMatchFull): string {
  const mins = Math.floor(d.duration / 60)
  const winRate = Math.round((d.agg.wins / d.agg.total) * 100)
  const itemList = d.items.length ? d.items.join(', ') : 'nada de relevante'
  const lines: string[] = []

  // Turbo
  if (d.isTurbo)
    lines.push(`${name} jogou Turbo. N\u00e3o \'e miss\u00e3o, \'e terceiriza\u00e7\u00e3o da vergonha.`)

  // Result vs performance
  if (!d.won && d.deaths >= 10)
    lines.push(`${d.kills}/${d.deaths}/${d.assists} de ${d.hero} e PERDEU. ${name} n\u00e3o jogou, fez entrega exprr\u00e9ss de ouro.`)
  else if (!d.won && d.kda < 1)
    lines.push(`${d.kills}/${d.deaths}/${d.assists} de ${d.hero} com KDA ${d.kda.toFixed(1)} e ainda perdeu. Matem\u00e1tica impiedosa.`)
  else if (d.won && d.deaths >= 10)
    lines.push(`Ganhou com ${d.deaths} mortes. O time de ${name} salvou a partida enquanto ${name} testava o respawn.`)
  else if (d.won && d.kda >= 8)
    lines.push(`${d.kills}/${d.deaths}/${d.assists} de ${d.hero}. Ok, ${name} absurdamente dominou. Isso s\u00f3 acontece em mirror match de KDA.`)

  // Support wards
  if ((d.laneRoleId === 4 || d.laneRoleId === 5) && d.obsPlaced === 0)
    lines.push(`${name} jogou suporte de ${d.hero} e comprou 0 wards. Isso n\u00e3o \u00e9 suporte, \u00e9 carry com menos farm.`)

  // Items
  if (d.items.length > 0)
    lines.push(`Build final: ${itemList}. ${name} foi ao sh\u00f3p de olhos fechados e pediu o pac\u00f3te surpresa.`)

  // GPM for carry
  if ((d.laneRoleId === 1 || d.laneRoleId === 2) && d.gpm < 350)
    lines.push(`${d.gpm} GPM de carry. At\u00e9 suporte de trilha comprida manda mais gold do que isso.`)

  // Low damage
  if (d.heroDamage < 8000 && d.duration > 1200)
    lines.push(`${d.heroDamage.toLocaleString()} de dano em ${mins} minutos. ${name} estava assistindo ou jogando?`)

  if (lines.length === 0)
    lines.push(`${name} foi ${d.kills}/${d.deaths}/${d.assists} de ${d.hero}. ${d.won ? 'Ganhou mediocrement\u00e9, parab\u00e9ns.' : 'Perdeu com consist\u00eancia, pelo menos.'}`)
  else if (lines.length === 1)
    lines.push(`Hist\u00f3rico recente: ${winRate}% de winrate. Contextualiza bastante o above.`)

  return lines.join('\n')
}

function roastLastFallbackEnUs(name: string, d: LastMatchFull): string {
  const mins = Math.floor(d.duration / 60)
  const winRate = Math.round((d.agg.wins / d.agg.total) * 100)
  const itemList = d.items.length ? d.items.join(', ') : 'nothing notable'
  const lines: string[] = []

  if (d.isTurbo)
    lines.push(`${name} played Turbo. Not a game mode\u2014a coping mechanism.`)

  if (!d.won && d.deaths >= 10)
    lines.push(`${d.kills}/${d.deaths}/${d.assists} on ${d.hero} and lost. ${name} didn't play\u2014they were the enemy team's personal ATM.`)
  else if (!d.won && d.kda < 1)
    lines.push(`${d.kills}/${d.deaths}/${d.assists} on ${d.hero} with a ${d.kda.toFixed(1)} KDA and still lost. The stats don't lie.`)
  else if (d.won && d.deaths >= 10)
    lines.push(`Won despite ${d.deaths} deaths. ${name}'s team carried the bag and then some.`)
  else if (d.won && d.kda >= 8)
    lines.push(`${d.kills}/${d.deaths}/${d.assists} on ${d.hero}. Fine, ${name} went absolutely nuclear this game. Suspicious.`)

  if ((d.laneRoleId === 4 || d.laneRoleId === 5) && d.obsPlaced === 0)
    lines.push(`${name} played support ${d.hero} and placed 0 observer wards. That's not support\u2014that's a carry with no farm.`)

  if (d.items.length > 0)
    lines.push(`Final build: ${itemList}. ${name} clearly shopped with their eyes closed.`)

  if ((d.laneRoleId === 1 || d.laneRoleId === 2) && d.gpm < 350)
    lines.push(`${d.gpm} GPM as a core. Even a support with no farm does better economically.`)

  if (d.heroDamage < 8000 && d.duration > 1200)
    lines.push(`${d.heroDamage.toLocaleString()} hero damage in ${mins} minutes. ${name}, were you playing or just spectating yourself?`)

  if (lines.length === 0)
    lines.push(`${name} went ${d.kills}/${d.deaths}/${d.assists} on ${d.hero}. ${d.won ? 'Won mediocrely. Congrats I guess.' : 'Lost consistently at least.'}`)
  else if (lines.length === 1)
    lines.push(`Recent history: ${winRate}% winrate. That contextualises everything above perfectly.`)

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

    const discordName = mention.displayName || mention.user.username
    const steamId = DISCORD_TO_STEAM[mention.user.username]

    //  No Steam ID: generic roast (AI-generated if available, else pool fallback) 
    if (!steamId) {
      const targetName = discordName
      const genericPrompt = LANG === 'pt-br'
        ? `Voc\u00ea \u00e9 um comediante de roast savage de Dota 2. Escreva 3-4 linhas de piadas sobre um jogador chamado ${targetName} que provavelmente \u00e9 ruim no Dota. Use humor brasileiro, seja espec\u00edfico e criativo. Sem cabe\u00e7alhos, sem markdown, s\u00f3 texto.`
        : `You are a savage Dota 2 roast comedian. Write 3-4 roast lines about a player named ${targetName} who is probably bad at Dota. Be specific and creative. No headers, no markdown, plain text only.`
      const pool = LANG === 'pt-br' ? GENERIC_ROASTS_PTBR : GENERIC_ROASTS_ENUS
      const poolFallback = pool[Math.floor(Math.random() * pool.length)].replace(/\{name\}/g, targetName)
      const roast = (await askAI(genericPrompt)) ?? poolFallback

      const requesterName = message.member?.displayName ?? message.author.username
      const embed = new EmbedBuilder()
        .setColor(0xff4500)
        .setTitle(t('roast.title'))
        .setDescription(roast)
        .setFooter({ text: t('roast.footer', { requester: requesterName }) })

      await message.channel.send({ embeds: [embed] })
      await message.channel.send(t('roast.noSteam', { name: targetName }))
      return
    }

    //  Has Steam ID: fetch real stats 
    // Convert Steam64  Steam32 if needed
    let accountId = steamId
    if (steamId.length >= 17)
      accountId = (BigInt(steamId) - BigInt('76561197960265728')).toString()

    // Resolve Dota 2 in-game nick first (usually cached)
    const targetName = await fetchDotaNick(accountId, discordName)

    await message.channel.send(t('roast.fetching', { name: targetName }))
    await (message.channel as any).sendTyping?.()

    const agg = await MatchHandler.fetchAggregate(accountId, 20)

    const requesterName = message.member?.displayName ?? message.author.username
    const embed = new EmbedBuilder()
      .setColor(0xff4500)
      .setTitle(t('roast.title'))
      .setFooter({ text: t('roast.footer', { requester: requesterName }) })

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

      const roastText = (await askAI(aiPrompt)) ?? hardcodedFallback

      embed
        .setDescription(roastText)
        .addFields(
          { name: ' Stats reais', value: `${agg.wins}W/${agg.total - agg.wins}L nos \ufffdltimos ${agg.total} jogos`, inline: true },
          { name: ' Mortes/jogo', value: `${agg.avgDeaths}`, inline: true },
          { name: ' KDA m\ufffddio', value: `${agg.avgKDA}`, inline: true },
        )
    }

    await message.channel.send({ embeds: [embed] })
  }

  /** !roastlast [@user|nick] — deep roast of the last match */
  static async roastLastMatch(message: Message, args: string) {
    // Resolve target — mention, nick, or self
    const mentioned = message.mentions.members?.first()
    let steamId: string | undefined
    let displayName: string

    if (mentioned) {
      if (mentioned.user.bot) {
        message.reply(t('common.botCannotRoast'))
        return
      }
      steamId = DISCORD_TO_STEAM[mentioned.user.username]
      displayName = mentioned.displayName
    } else if (args.trim()) {
      const lower = args.trim().toLowerCase()
      const key = Object.keys(DISCORD_TO_STEAM).find(k => k.toLowerCase().includes(lower))
      if (key) {
        steamId = DISCORD_TO_STEAM[key]
        displayName = key
      } else {
        const available = Object.keys(DISCORD_TO_STEAM).join(', ')
        message.reply(t('roastlast.notFound', { nicks: available }))
        return
      }
    } else {
      // Roast the caller themselves
      steamId = DISCORD_TO_STEAM[message.author.username]
      displayName = message.member?.displayName ?? message.author.username
    }

    if (!steamId) {
      message.reply(t('roastlast.noSteam', { name: displayName! }))
      return
    }

    // Convert Steam64 → Steam32 if needed
    let accountId = steamId
    if (steamId.length >= 17)
      accountId = (BigInt(steamId) - BigInt('76561197960265728')).toString()

    const targetName = await fetchDotaNick(accountId, displayName!)

    await message.channel.send(t('roastlast.fetching', { name: targetName }))
    await (message.channel as any).sendTyping?.()

    const data = await MatchHandler.fetchLastMatchFull(accountId)

    const requesterName = message.member?.displayName ?? message.author.username

    if (!data) {
      message.reply(t('roastlast.noData', { name: targetName }))
      return
    }

    const winRate = Math.round((data.agg.wins / data.agg.total) * 100)
    const mins = Math.floor(data.duration / 60)
    const secs = data.duration % 60

    const aiPrompt = roastLastMatchPrompt({
      lang: LANG,
      name: targetName,
      hero: data.hero,
      kills: data.kills,
      deaths: data.deaths,
      assists: data.assists,
      kda: data.kda,
      gpm: data.gpm,
      xpm: data.xpm,
      heroDamage: data.heroDamage,
      towerDamage: data.towerDamage,
      lastHits: data.lastHits,
      denies: data.denies,
      netWorth: data.netWorth,
      level: data.level,
      duration: data.duration,
      won: data.won,
      isTurbo: data.isTurbo,
      gameMode: data.gameMode,
      laneRole: data.laneRole,
      items: data.items,
      obsPlaced: data.obsPlaced,
      senPlaced: data.senPlaced,
      campsStacked: data.campsStacked,
      avgDeaths: data.agg.avgDeaths,
      avgKDA: data.agg.avgKDA,
      winRate,
      streak: data.agg.currentStreak,
      total: data.agg.total,
    })

    const fallback = LANG === 'pt-br'
      ? roastLastFallbackPtBr(targetName, data)
      : roastLastFallbackEnUs(targetName, data)

    const roastText = (await askAI(aiPrompt, 500)) ?? fallback

    const itemDisplay = data.items.length
      ? data.items.join(', ')
      : t('roastlast.noItems')

    const streakLabel = data.agg.currentStreak > 0
      ? `${data.agg.currentStreak}x ${t('match.streakWins')}`
      : `${Math.abs(data.agg.currentStreak)}x ${t('match.streakLosses')}`

    const embed = new EmbedBuilder()
      .setColor(data.won ? 0xff6a00 : 0xff1a1a)
      .setTitle(t('roastlast.title', { hero: data.hero, result: data.won ? t('match.victory') : t('match.defeat') }))
      .setDescription(`*${roastText}*`)
      .addFields(
        { name: t('match.fieldKDA'), value: `**${data.kills}/${data.deaths}/${data.assists}** (${data.kda.toFixed(1)})`, inline: true },
        { name: t('match.fieldGPMXPM'), value: `${data.gpm} / ${data.xpm}`, inline: true },
        { name: t('match.fieldMode'), value: `${data.gameMode}`, inline: true },
        { name: t('roastlast.fieldPosition'), value: data.laneRole, inline: true },
        { name: t('match.fieldLastHits'), value: `${data.lastHits} / ${data.denies}`, inline: true },
        { name: t('match.fieldDuration'), value: `${mins}m ${secs.toString().padStart(2, '0')}s`, inline: true },
        { name: t('match.fieldHeroDmg'), value: data.heroDamage.toLocaleString(), inline: true },
        { name: t('match.fieldTowerDmg'), value: data.towerDamage.toLocaleString(), inline: true },
        { name: t('roastlast.fieldNetWorth'), value: data.netWorth.toLocaleString(), inline: true },
        { name: t('roastlast.fieldItems'), value: itemDisplay, inline: false },
        {
          name: t('roastlast.fieldWards'),
          value: `👁 ${data.obsPlaced} obs  |  🔴 ${data.senPlaced} sen  |  🏕 ${data.campsStacked} stacks`,
          inline: false,
        },
        {
          name: t('match.fieldTrend', { count: data.agg.total }),
          value: [
            t('match.trendWinRate', { wins: data.agg.wins, total: data.agg.total, pct: winRate }),
            t('match.trendAvgKDA', { kda: data.agg.avgKDA }),
            t('match.trendAvgDeaths', { avg: data.agg.avgDeaths }),
            t('match.trendFavHero', { hero: data.agg.favouriteHero, count: data.agg.favouriteHeroCount }),
            streakLabel,
          ].join('\n'),
          inline: false,
        },
      )
      .setFooter({
        text: t('roastlast.footer', {
          name: targetName,
          date: new Date(data.startTime * 1000).toLocaleDateString(),
          id: data.matchId,
          requester: requesterName,
        }),
      })

    await message.channel.send({ embeds: [embed] })
  }
}
