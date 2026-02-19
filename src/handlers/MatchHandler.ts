import https from 'https'
import { Message, EmbedBuilder } from 'discord.js'
import { DISCORD_TO_STEAM, fetchDotaNick } from './BetHandler'
import { t, LANG } from '../i18n'
import { askAI, matchCommentaryPrompt } from '../ai'

const OPENDOTA_API = 'https://api.opendota.com/api'
const RECENT_MATCH_COUNT = 20

//  Interfaces 

interface RecentMatch {
  match_id: number
  hero_id: number
  kills: number
  deaths: number
  assists: number
  last_hits: number
  denies: number
  gold_per_min: number
  xp_per_min: number
  hero_damage: number
  tower_damage: number
  hero_healing: number
  level: number
  duration: number
  game_mode: number
  lobby_type: number
  start_time: number
  player_slot: number
  radiant_win: boolean
  party_size: number
}

interface AggregateStats {
  total: number
  wins: number
  avgKDA: number
  avgDeaths: number
  avgGPM: number
  favouriteHero: string
  favouriteHeroCount: number
  currentStreak: number          // positive = wins, negative = losses
  worstDeathsGame: number
  totalFeedGames: number         // games with 10+ deaths
}

//  Game mode labels 

const GAME_MODES: Record<number, string> = {
  0: 'Unknown',  1: 'All Pick',  2: "Captain's Mode",
  3: 'Random Draft',  4: 'Single Draft',  5: 'All Random',
  22: 'Ranked All Pick',  23: 'Turbo',
}

//  Hero map cache 

const heroMap: Record<number, string> = {}

function httpsGet(url: string): Promise<any> {
  return new Promise((resolve) => {
    https.get(url, { headers: { 'User-Agent': 'discord-bot/1.0' } }, (res) => {
        let body = ''
        res.on('data', (chunk: any) => (body += chunk))
        res.on('end', () => { try { resolve(JSON.parse(body)) } catch { resolve(null) } })
      }).on('error', () => resolve(null))
  })
}

async function loadHeroMap() {
  if (Object.keys(heroMap).length > 0) return
  const heroes = await httpsGet(`${OPENDOTA_API}/heroes`)
  if (Array.isArray(heroes)) for (const h of heroes) heroMap[h.id] = h.localized_name
}

function heroName(id: number): string {
  return heroMap[id] || `Hero #${id}`
}

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60)
  const secs = seconds % 60
  return `${mins}m ${secs.toString().padStart(2, '0')}s`
}

//  Aggregate computation 

function computeAggregate(matches: RecentMatch[]): AggregateStats {
  const wins = matches.filter(m => {
    const radiant = m.player_slot < 128
    return (radiant && m.radiant_win) || (!radiant && !m.radiant_win)
  }).length

  const totKDA = matches.reduce((s, m) => {
    const kda = m.deaths === 0 ? m.kills + m.assists : (m.kills + m.assists) / m.deaths
    return s + kda
  }, 0)
  const totDeaths = matches.reduce((s, m) => s + m.deaths, 0)
  const totGPM = matches.reduce((s, m) => s + m.gold_per_min, 0)

  // Hero frequency
  const heroCounts: Record<number, number> = {}
  for (const m of matches) heroCounts[m.hero_id] = (heroCounts[m.hero_id] || 0) + 1
  const [topHeroId, topHeroCount] = Object.entries(heroCounts)
    .sort((a, b) => Number(b[1]) - Number(a[1]))[0]

  // Current streak (from most-recent backwards)
  let streakRef: boolean | null = null
  let streak = 0
  for (const m of matches) {
    const radiant = m.player_slot < 128
    const won = (radiant && m.radiant_win) || (!radiant && !m.radiant_win)
    if (streakRef === null) { streakRef = won; streak = 1 }
    else if (won === streakRef) streak++
    else break
  }

  return {
    total: matches.length,
    wins,
    avgKDA: Math.round((totKDA / matches.length) * 10) / 10,
    avgDeaths: Math.round((totDeaths / matches.length) * 10) / 10,
    avgGPM: Math.round(totGPM / matches.length),
    favouriteHero: heroName(Number(topHeroId)),
    favouriteHeroCount: Number(topHeroCount),
    currentStreak: streakRef === true ? streak : -streak,
    worstDeathsGame: Math.max(...matches.map(m => m.deaths)),
    totalFeedGames: matches.filter(m => m.deaths >= 10).length,
  }
}

//  PT-BR Commentary engine 

const pick = (arr: string[]) => arr[Math.floor(Math.random() * arr.length)]

interface CommentCtx {
  name: string; hero: string
  kills: number; deaths: number; assists: number
  gpm: number; heroDamage: number
  won: boolean; kda: number
  agg: AggregateStats
}

function commentaryPtBr(ctx: CommentCtx): string {
  const { name, hero, kills, deaths, assists, gpm, heroDamage, won, kda, agg } = ctx
  const winRate = Math.round((agg.wins / agg.total) * 100)

  //  Special multi-match observations 
  if (agg.currentStreak <= -5)
    return pick([
      `${name} est\ufffd em uma sequ\ufffdncia de ${Math.abs(agg.currentStreak)} DERROTAS seguidas de ${hero}. Essa \ufffd a vibe de algu\ufffdm que vai desinstalar o Dota essa semana.`,
      `${Math.abs(agg.currentStreak)} derrotas seguidas e ainda voltou. ${name}, tem um limite chamado dignidade.`,
    ])
  if (agg.currentStreak >= 5)
    return pick([
      `${agg.currentStreak} vit\ufffdrias seguidas e ainda jogando ${hero}?? ${name} claramente tomou a dose certa de caf\ufffd hoje(s).`,
      `${name} est\ufffd EM CHAMAS  ${agg.currentStreak} wins seguidas! Quem liga pra um n\ufffdmero de KDA quando voc\ufffd est\ufffd sendo RID\ufffdCULO assim?`,
    ])
  if (agg.totalFeedGames >= 4)
    return pick([
      `${name} deu 10+ mortes em ${agg.totalFeedGames} das \ufffdltimas ${agg.total} partidas. Isso n\ufffdo \ufffd Dota, \ufffd doa\ufffd\ufffdo volunt\ufffdria de ouro.`,
      `An\ufffdlise estat\ufffdstica: ${name} deu feed em ${agg.totalFeedGames}/${agg.total} partidas recentes. O sistema de detec\ufffd\ufffdo de smurfs n\ufffdo existe pra te detectar porque voc\ufffd come smurf de caf\ufffd da manh\ufffd... de baixo.`,
    ])
  if (winRate <= 20 && agg.total >= 5)
    return pick([
      `${winRate}% de winrate nas \ufffdltimas ${agg.total} partidas. ${name} est\ufffd tecnicamente a destruir o pr\ufffdprio MMR de forma profissional.`,
      `${agg.wins} vit\ufffdrias em ${agg.total} partidas. ${name} est\ufffd jogando Dota ou testando a resili\ufffdncia psicol\ufffdgica?`,
    ])
  if (winRate >= 80 && agg.total >= 5)
    return pick([
      `${winRate}% de winrate nos \ufffdltimos ${agg.total} jogos  ${name} est\ufffd literalmente smurfando ou o MMR do servidor \ufffd um jardim de inf\ufffdncia.`,
      `${name} ganhou ${agg.wins} de ${agg.total} ultimamente. Respeito genu\ufffdno. Agora vai pra ranked e estraga a vida de algu\ufffdm proporcionalmente treinado.`,
    ])

  //  Last-match specific 
  if (deaths === 0 && kills >= 10)
    return pick([
      `IMORTAL! ${name} com ${hero}: ${kills}/${deaths}/${assists}. Zero mortes, ${kills} kills. O inimigo viu voc\ufffd e pediu desculpas.`,
      `${kills}/${deaths}/${assists} de ${hero}  ${name} n\ufffdo jogou Dota hoje, ele fez um document\ufffdrio sobre genoc\ufffddio.`,
    ])
  if (deaths === 0 && kills === 0 && won)
    return pick([
      `${name} ganhou de ${hero} com ${kills}/${deaths}/${assists}. Participa\ufffd\ufffdo: nenhuma. Resultado: vit\ufffdria. M\ufffdtodo: mist\ufffdrio.`,
      `Arquibancada premium. ${name} ficou 0/0/${assists} de ${hero} e ainda levou XP. Isso \ufffd suporte ou aposentadoria antecipada?`,
    ])
  if (deaths >= 20)
    return pick([
      `${deaths} MORTES COM ${hero.toUpperCase()}. ${name}, o respawn tinha fila hoje?`,
      `${name} morreu ${deaths} vezes de ${hero}. O n\ufffdmero de mortes supera a pr\ufffdpria dura\ufffd\ufffdo da partida em minutos. Isso \ufffd um recorde.`,
      `${kills}/${deaths}/${assists} de ${hero}. ${name} n\ufffdo jogou, ele foi de coelho pra ca\ufffdada.`,
    ])
  if (deaths >= 15)
    return pick([
      `${deaths} mortes de ${hero}. ${name} distribuiu gold como influencer distribuindo c\ufffddigo de desconto.`,
      `${name} com ${hero}: ${kills}/${deaths}/${assists}. O inimigo provavelmente tem um fundo de investimento com o ouro que voc\ufffd deu.`,
    ])
  if (gpm < 180 && heroDamage < 8000)
    return pick([
      `${gpm} GPM e ${heroDamage} de dano de ${hero}. ${name} estava em AFK ou simplesmente invis\ufffdvel pro jogo tamb\ufffdm?`,
      `${name} terminou ${kills}/${deaths}/${assists} de ${hero} com ${gpm} GPM. Uma creep neutral teve mais impacto.`,
    ])

  //  Won 
  if (won) {
    if (kda >= 10) return pick([
      `${name} DESTRUIU de ${hero}: ${kills}/${deaths}/${assists}. KDA ${kda.toFixed(1)}. Isso foi partida ou assalto \ufffd m\ufffdo armada?`,
      `${kda.toFixed(1)} de KDA com ${hero}. ${name} hoje n\ufffdo era jogador, era fen\ufffdmeno clim\ufffdtico.`,
    ])
    if (kda >= 6) return pick([
      `Bom jogo, ${name}! ${kills}/${deaths}/${assists} de ${hero}. ${winRate}% winrate recente tamb\ufffdm. Perigoso.`,
      `${name} com ${hero}: ${kills}/${deaths}/${assists}. S\ufffdlido, consistente, perigosamente respeit\ufffdvel.`,
    ])
    if (kda >= 3) return pick([
      `${name} ganhou com ${hero}, ${kills}/${deaths}/${assists}. Nada \ufffdpico, mas pelo menos n\ufffdo desonrou a fam\ufffdlia.`,
      `Vit\ufffdria tranquila pra ${name} de ${hero}. ${kills}/${deaths}/${assists}  fez o m\ufffdnimo necess\ufffdrio e funcionou.`,
    ])
    if (kda >= 1) return pick([
      `${name} ganhou de ${hero} com ${kills}/${deaths}/${assists}. Claramente carregado, mas ganhou. N\ufffdo precisa ser hero pra ganhar.`,
      `Ganhou com ${hero}, ${kills}/${deaths}/${assists}. ${name} foi o sexto jogador do time advers\ufffdrio hoje.`,
    ])
    return pick([
      `${name} foi ${kills}/${deaths}/${assists} de ${hero} e ganhou. Parab\ufffdns ao time. Eles salvaram voc\ufffd.`,
      `Vit\ufffdria! Mas ${name} de ${hero} com ${kills}/${deaths}/${assists}... voc\ufffd contribuiu ou assistiu?`,
    ])
  }

  //  Lost 
  if (kda >= 6) return pick([
    `${name} foi ${kills}/${deaths}/${assists} de ${hero} e PERDEU. Com esse KDA voc\ufffd deveria ter impedido isso. O que deu errado?`,
    `${kills}/${deaths}/${assists} de ${hero} e ainda caiu. ${name} deveria processar os teammates por neglig\ufffdncia.`,
  ])
  if (kda >= 3) return pick([
    `${name} foi ${kills}/${deaths}/${assists} de ${hero} e perdeu. Contribuiu. N\ufffdo salvou. Acontece.`,
    `Derrota com ${hero}: ${kills}/${deaths}/${assists}. ${name} fez a parte dele. Os outros... n\ufffdo tanto.`,
  ])
  if (kda >= 1.5) return pick([
    `${kills}/${deaths}/${assists} de ${hero} e perdeu. ${name} ajudou mais do que atrapalhou? Tenho d\ufffdvidas s\ufffdrias.`,
    `${name} com ${hero}: ${kills}/${deaths}/${assists}. Jogo mediocre, resultado mediocre. Pr\ufffdxima partida.`,
  ])
  if (kda >= 0.5) return pick([
    `${name} de ${hero}: ${kills}/${deaths}/${assists} e derrota. Isso foi... ruim. Por respeito n\ufffdo vou detalhar.`,
    `${kills}/${deaths}/${assists} de ${hero} e perdeu. ${name}, voc\ufffd veio jogar Dota ou entregar comida pro inimigo?`,
  ])
  return pick([
    `Epit\ufffdfio de ${name}: "${kills}/${deaths}/${assists} de ${hero}. Achou que estava bem."`,
    `${name} com ${hero}: ${kills}/${deaths}/${assists}. Derrota merecida. N\ufffdo precisa de an\ufffdlise.`,
    `${kills}/${deaths}/${assists} de ${hero} e perdeu. ${name} n\ufffdo jogou Dota, jogou um simulador de feeding.`,
  ])
}

function commentaryEnUs(ctx: CommentCtx): string {
  const { name, hero, kills, deaths, assists, gpm, heroDamage, won, kda, agg } = ctx
  const winRate = Math.round((agg.wins / agg.total) * 100)

  if (agg.currentStreak <= -5) return pick([
    `${name} is on a ${Math.abs(agg.currentStreak)}-loss streak on ${hero}. Someone needs a break. Or a new game.`,
    `${Math.abs(agg.currentStreak)} losses in a row and they're still here. ${name}, at what point do you call it?`,
  ])
  if (agg.currentStreak >= 5) return pick([
    `${agg.currentStreak} wins in a row! ${name} is absolutely cooking right now  someone's getting reported just for being in the lobby.`,
    `${name} is ON FIRE  ${agg.currentStreak} consecutive wins. Don't even check the KDA, they're just built different today.`,
  ])
  if (agg.totalFeedGames >= 4) return pick([
    `${name} has 10+ deaths in ${agg.totalFeedGames} of their last ${agg.total} games. That's not a losing streak, that's a lifestyle.`,
    `Statistical analysis: ${name} has fed in ${agg.totalFeedGames}/${agg.total} recent games. The enemy team buys a house with your gold.`,
  ])
  if (winRate <= 20 && agg.total >= 5) return pick([
    `${winRate}% winrate in the last ${agg.total} games. ${name} is professionally speed-running MMR destruction.`,
    `${agg.wins} wins out of ${agg.total}. At this point ${name} is doing the enemy team's ranked grind for them.`,
  ])
  if (winRate >= 80 && agg.total >= 5) return pick([
    `${winRate}% winrate over ${agg.total} games  ${name} is either smurfing or everyone else is in preschool.`,
    `${name} won ${agg.wins} of ${agg.total} recently. Actual respect. Now go hit ranked and ruin someone more qualified.`,
  ])

  if (deaths === 0 && kills >= 10) return pick([
    `IMMORTAL! ${name} on ${hero}: ${kills}/${deaths}/${assists}. Zero deaths. The enemy team filed a formal complaint.`,
    `${kills}/${deaths}/${assists} on ${hero}  ${name} didn't play Dota today, they committed crimes against the enemy base.`,
  ])
  if (deaths === 0 && kills === 0 && won) return pick([
    `${name} won on ${hero} at ${kills}/${deaths}/${assists}. Participation: zero. Result: victory. Method: unknown.`,
    `Premium spectator mode. ${name} went 0/0/${assists} on ${hero} and still got XP. Is this support or early retirement?`,
  ])
  if (deaths >= 20) return pick([
    `${deaths} DEATHS ON ${hero.toUpperCase()}. ${name}, was there a queue at the respawn fountain?`,
    `${kills}/${deaths}/${assists} on ${hero}. ${name} didn't play  they were the enemy team's farm route.`,
  ])
  if (deaths >= 15) return pick([
    `${deaths} deaths on ${hero}. ${name} distributed gold like a charity. Very generous.`,
    `${name} on ${hero}: ${kills}/${deaths}/${assists}. The enemy probably has a portfolio built on your deaths.`,
  ])
  if (gpm < 180 && heroDamage < 8000) return pick([
    `${gpm} GPM and ${heroDamage} damage on ${hero}. ${name} was either AFK or invisible to the game engine too.`,
    `${kills}/${deaths}/${assists} on ${hero} with ${gpm} GPM. A neutral creep had more economic impact than you.`,
  ])

  if (won) {
    if (kda >= 10) return pick([
      `${name} went OFF on ${hero}: ${kills}/${deaths}/${assists}. KDA ${kda.toFixed(1)}. That wasn't a game, that was a crime.`,
      `${kda.toFixed(1)} KDA on ${hero}. ${name} wasn't playing today  they were a natural disaster.`,
    ])
    if (kda >= 6) return pick([
      `Solid win, ${name}! ${kills}/${deaths}/${assists} on ${hero}, ${winRate}% winrate recently. Actually scary.`,
      `${name} with ${hero}: ${kills}/${deaths}/${assists}. Consistent, dangerous, borderline respectable.`,
    ])
    if (kda >= 3) return pick([
      `${name} won on ${hero}, ${kills}/${deaths}/${assists}. Not epic, but didn't embarrass anyone either.`,
      `Clean enough win for ${name} on ${hero}. ${kills}/${deaths}/${assists}  did the job, got the dub.`,
    ])
    if (kda >= 1) return pick([
      `${name} won on ${hero} at ${kills}/${deaths}/${assists}. Clearly carried but who's counting wins right.`,
      `Won with ${hero}, ${kills}/${deaths}/${assists}. ${name} was basically the enemy team's sixth player today.`,
    ])
    return pick([
      `${name} went ${kills}/${deaths}/${assists} on ${hero} and still won. Congratulations to the team. They deserved it.`,
      `Victory! But ${name} on ${hero} at ${kills}/${deaths}/${assists}... did you contribute or just spectate?`,
    ])
  }

  if (kda >= 6) return pick([
    `${name} went ${kills}/${deaths}/${assists} on ${hero} and LOST. With that KDA you had one job. What happened?`,
    `${kills}/${deaths}/${assists} on ${hero} and still lost. ${name} should sue their teammates for negligence.`,
  ])
  if (kda >= 3) return pick([
    `${name} went ${kills}/${deaths}/${assists} on ${hero} and lost. Did their part. Others didn't. Moving on.`,
    `Loss on ${hero}: ${kills}/${deaths}/${assists}. ${name} held up their end. The rest of the team did not.`,
  ])
  if (kda >= 1.5) return pick([
    `${kills}/${deaths}/${assists} on ${hero} and lost. ${name}, did you help more than hurt? Because I genuinely have doubts.`,
    `${name} on ${hero}: ${kills}/${deaths}/${assists}. Mediocre game, mediocre result. Next.`,
  ])
  if (kda >= 0.5) return pick([
    `${name} on ${hero}: ${kills}/${deaths}/${assists} and a loss. That was... bad. Out of respect I'll stop there.`,
    `${kills}/${deaths}/${assists} on ${hero} and lost. ${name}, were you playing or just providing delivery service to the enemy?`,
  ])
  return pick([
    `${name}'s tombstone: "${kills}/${deaths}/${assists} on ${hero}. Thought it was going well."`,
    `${name} on ${hero}: ${kills}/${deaths}/${assists}. Deserved defeat. No further analysis needed.`,
    `${kills}/${deaths}/${assists} on ${hero} and lost. ${name} didn't play Dota  they ran a feeding simulator.`,
  ])
}

function getCommentary(ctx: CommentCtx): string {
  return LANG === 'pt-br' ? commentaryPtBr(ctx) : commentaryEnUs(ctx)
}

//  Steam ID resolution 

function resolveSteamId(
  message: Message,
  args: string
): { steamId: string; displayName: string } | null {
  const mentioned = message.mentions.members?.first()
  if (mentioned) {
    const steamId = DISCORD_TO_STEAM[mentioned.user.username]
    if (!steamId) return null
    return { steamId, displayName: mentioned.displayName }
  }
  if (/^\d{5,}$/.test(args))
    return { steamId: args, displayName: `Steam ${args}` }
  const lower = args.toLowerCase()
  const key = Object.keys(DISCORD_TO_STEAM).find(k => k.toLowerCase().includes(lower))
  if (key) return { steamId: DISCORD_TO_STEAM[key], displayName: key }
  return null
}

//  Handler 

export class MatchHandler {
  /** Legacy entry point used by !match <steamId> */
  static async getLastMatch(message: Message, steamId: string) {
    await MatchHandler._fetch(message, steamId, null)
  }

  /** New entry point: !lastmatch @user | <nick> */
  static async lastMatch(message: Message, args: string) {
    const resolved = resolveSteamId(message, args.trim())
    if (!resolved) {
      const available = Object.keys(DISCORD_TO_STEAM).join(', ')
      message.reply(t('match.notFound', { nicks: available }))
      return
    }
    await MatchHandler._fetch(message, resolved.steamId, resolved.displayName)
  }

  private static async _fetch(message: Message, steamId: string, displayName: string | null) {
    try {
      await (message.channel as any).sendTyping?.()
      await loadHeroMap()

      let accountId = steamId
      if (steamId.length >= 17)
        accountId = (BigInt(steamId) - BigInt('76561197960265728')).toString()

      const recent: RecentMatch[] = await httpsGet(
        `${OPENDOTA_API}/players/${accountId}/recentMatches`
      )
      if (!recent || recent.length === 0) {
        message.reply(t('match.noRecent'))
        return
      }

      const matches = recent.slice(0, RECENT_MATCH_COUNT)
      const agg = computeAggregate(matches)
      const m = matches[0]

      // Fetch full match details in parallel to get denies + level (not in recentMatches)
      const fullMatch = await httpsGet(`${OPENDOTA_API}/matches/${m.match_id}`)
      const fullPlayer = fullMatch?.players?.find(
        (p: any) => p.account_id === Number(accountId)
      )
      const denies: number = fullPlayer?.denies ?? 0
      const level: number  = fullPlayer?.level  ?? 0

      const isRadiant = m.player_slot < 128
      const won = (isRadiant && m.radiant_win) || (!isRadiant && !m.radiant_win)
      const hero = heroName(m.hero_id)
      const kda = m.deaths === 0 ? m.kills + m.assists : (m.kills + m.assists) / m.deaths
      const playerName = await fetchDotaNick(accountId, displayName ?? `Steam ${accountId}`)

      const fallbackCtx = {
        name: playerName, hero,
        kills: m.kills, deaths: m.deaths, assists: m.assists,
        gpm: m.gold_per_min, heroDamage: m.hero_damage ?? 0,
        won, kda, agg,
      }
      const aiCommentaryPrompt = matchCommentaryPrompt({
        lang: LANG,
        name: playerName, hero,
        kills: m.kills, deaths: m.deaths, assists: m.assists,
        kda, won,
        gpm: m.gold_per_min,
        heroDamage: m.hero_damage ?? 0,
        winRate: Math.round(agg.wins / agg.total * 100),
        avgDeaths: agg.avgDeaths,
        avgKDA: agg.avgKDA,
        favHero: agg.favouriteHero,
        streak: agg.currentStreak,
        total: agg.total,
      })
      const commentary = (await askAI(aiCommentaryPrompt)) ?? getCommentary(fallbackCtx)

      const streakLabel = agg.currentStreak > 0
        ? t('match.trendStreak', { count: agg.currentStreak, type: t('match.streakWins') })
        : t('match.trendStreak', { count: Math.abs(agg.currentStreak), type: t('match.streakLosses') })

      const trendLines = [
        t('match.trendWinRate', { wins: agg.wins, total: agg.total, pct: Math.round(agg.wins / agg.total * 100) }),
        t('match.trendAvgKDA', { kda: agg.avgKDA }),
        t('match.trendAvgDeaths', { avg: agg.avgDeaths }),
        t('match.trendFavHero', { hero: agg.favouriteHero, count: agg.favouriteHeroCount }),
        streakLabel,
      ].join('\n')

      const embed = new EmbedBuilder()
        .setColor(won ? 0x57f287 : 0xed4245)
        .setTitle(`${won ? t('match.victory') : t('match.defeat')}  ${hero}`)
        .setDescription(`*${commentary}*`)
        .addFields(
          { name: t('match.fieldKDA'), value: `**${m.kills}/${m.deaths}/${m.assists}** (${kda.toFixed(1)})`, inline: true },
          { name: t('match.fieldGPMXPM'), value: `${m.gold_per_min} / ${m.xp_per_min}`, inline: true },
          { name: t('match.fieldDuration'), value: formatDuration(m.duration), inline: true },
          { name: t('match.fieldLastHits'), value: `${m.last_hits ?? 0} / ${denies}`, inline: true },
          { name: t('match.fieldHeroDmg'), value: (m.hero_damage ?? 0).toLocaleString(), inline: true },
          { name: t('match.fieldTowerDmg'), value: (m.tower_damage ?? 0).toLocaleString(), inline: true },
          { name: t('match.fieldHealing'), value: (m.hero_healing ?? 0).toLocaleString(), inline: true },
          { name: t('match.fieldLevel'), value: `${level || '-'}`, inline: true },
          { name: t('match.fieldMode'), value: GAME_MODES[m.game_mode] ?? 'Unknown', inline: true },
          { name: t('match.fieldTrend', { count: agg.total }), value: trendLines, inline: false },
        )
        .setFooter({
          text: t('match.footerText', {
            name: playerName,
            date: new Date(m.start_time * 1000).toLocaleDateString(),
            id: m.match_id,
          }),
        })

      message.channel.send({ embeds: [embed] })
    } catch (err: any) {
      console.error('[MatchHandler] Error:', err?.message ?? err)
      message.reply(t('match.error'))
    }
  }

  /** Exported for RoastHandler: returns aggregate stats for a steam accountId */
  static async fetchAggregate(accountId: string, count = RECENT_MATCH_COUNT): Promise<AggregateStats | null> {
    try {
      await loadHeroMap()
      const recent: RecentMatch[] = await httpsGet(
        `${OPENDOTA_API}/players/${accountId}/recentMatches`
      )
      if (!recent || recent.length === 0) return null
      return computeAggregate(recent.slice(0, count))
    } catch {
      return null
    }
  }
}
