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

export interface ItemTiming {
  item: string
  time: number           // seconds into the game
}

export interface LastMatchFull {
  matchId: number
  hero: string
  kills: number
  deaths: number
  assists: number
  kda: number
  gpm: number
  xpm: number
  heroDamage: number
  towerDamage: number
  heroHealing: number
  lastHits: number
  denies: number
  netWorth: number
  level: number
  duration: number
  won: boolean
  isTurbo: boolean
  gameMode: string
  laneRole: string
  laneRoleId: number
  /** Detected Dota position 1-5 based on net worth ranking within team */
  position: number
  positionLabel: string
  items: string[]
  obsPlaced: number
  senPlaced: number
  campsStacked: number
  startTime: number
  // ── Rich parsed data ──
  /** Key item purchase timings (completed items only, sorted by time) */
  itemTimings: ItemTiming[]
  /** Map of hero name → times that hero killed this player */
  killedBy: Record<string, number>
  /** Most killed by: { hero, count } */
  nemesis: { hero: string; count: number } | null
  /** Benchmarks percentile (0-1) vs other players of same hero */
  benchmarks: {
    gpmPct: number
    xpmPct: number
    killsPct: number
    lastHitsPct: number
    heroDmgPct: number
    healingPct: number
    towerDmgPct: number
  } | null
  /** Teamfight participation 0-1 */
  teamfightParticipation: number
  /** Lane efficiency percentage (0-100) */
  laneEfficiency: number
  /** Total seconds spent dead */
  timeSpentDead: number
  /** Stuns applied in seconds */
  stunSeconds: number
  /** Buyback count */
  buybackCount: number
  /** Actions per minute */
  apm: number
  /** Sentry wards dewarded */
  sentryKills: number
  /** Observer wards dewarded */
  observerKills: number
  /** Courier kills */
  courierKills: number
  /** Rune pickups */
  runePickups: number
  /** Whether the match was parsed (full data available) */
  isParsed: boolean
  agg: AggregateStats
}

//  Game mode labels 

const GAME_MODES: Record<number, string> = {
  0: 'Unknown',  1: 'All Pick',  2: "Captain's Mode",
  3: 'Random Draft',  4: 'Single Draft',  5: 'All Random',
  22: 'Ranked All Pick',  23: 'Turbo',
}

//  Hero map cache 

const heroMap: Record<number, string> = {}

//  Item map cache 

const itemMap: Record<number, string> = {}

async function loadItemMap() {
  if (Object.keys(itemMap).length > 0) return
  const items = await httpsGet(`${OPENDOTA_API}/constants/items`)
  if (items && typeof items === 'object') {
    for (const val of Object.values(items)) {
      const v = val as any
      if (v.id && v.dname) itemMap[v.id] = v.dname
    }
  }
}

function itemName(id: number): string {
  if (!id || id === 0) return ''
  return itemMap[id] || `Item #${id}`
}

const LANE_NAMES: Record<number, string> = {
  1: 'Safe Lane',
  2: 'Mid Lane',
  3: 'Off Lane',
}

const POSITION_LABELS: Record<number, string> = {
  1: 'Hard Carry (Position 1)',
  2: 'Mid (Position 2)',
  3: 'Offlaner (Position 3)',
  4: 'Soft Support (Position 4)',
  5: 'Hard Support (Position 5)',
}

function positionLabel(pos: number): string {
  return POSITION_LABELS[pos] || 'Unknown Position'
}

function laneRoleName(role: number): string {
  return LANE_NAMES[role] || 'Unknown Lane'
}

/**
 * Detect the actual Dota position (1-5) by ranking net worth within the team.
 * Position 1 = highest NW core, Position 5 = lowest NW support.
 * Falls back to lane_role if team data is unavailable.
 */
function detectPosition(fullMatch: any, fullPlayer: any, playerSlot: number): number {
  if (!fullMatch?.players || !fullPlayer) return fullPlayer?.lane_role ?? 0

  const isRadiant = playerSlot < 128
  const teammates = fullMatch.players
    .filter((p: any) => (p.player_slot < 128) === isRadiant)
    .sort((a: any, b: any) => (b.net_worth ?? b.gold_per_min ?? 0) - (a.net_worth ?? a.gold_per_min ?? 0))

  const idx = teammates.findIndex((p: any) => p.player_slot === playerSlot)
  if (idx < 0) return fullPlayer?.lane_role ?? 0
  return idx + 1  // 1-indexed: pos 1 (highest NW) to pos 5 (lowest NW)
}

// Item keys to ignore when building item timings (consumables, components, etc.)
const IGNORED_ITEM_KEYS = new Set([
  'tango', 'flask', 'clarity', 'faerie_fire', 'branches', 'tpscroll',
  'ward_observer', 'ward_sentry', 'ward_dispenser', 'smoke_of_deceit',
  'dust', 'enchanted_mango', 'blood_grenade', 'gauntlets', 'slippers',
  'mantle', 'circlet', 'ring_of_protection', 'quelling_blade', 'stout_shield',
  'orb_of_venom', 'blight_stone', 'wind_lace', 'ring_of_regen',
  'sobi_mask', 'gloves', 'boots', 'blades_of_attack', 'chainmail',
  'robe', 'belt_of_strength', 'ogre_axe', 'staff_of_wizardry', 'blade_of_alacrity',
  'broadsword', 'claymore', 'javelin', 'mithril_hammer', 'cloak',
  'helm_of_iron_will', 'ring_of_health', 'void_stone', 'mystic_staff',
  'energy_booster', 'vitality_booster', 'point_booster', 'platemail',
  'hyperstone', 'ultimate_orb', 'demon_edge', 'eaglesong', 'reaver', 'sacred_relic',
  'recipe_magic_wand', 'recipe_urn_of_shadows', 'recipe_mekansm',
  'famango', 'mana_draught', 'madstone_bundle', 'blitz_knuckles',
  // skip any 'recipe_*'
])

function isCompletedItem(key: string): boolean {
  if (key.startsWith('recipe_')) return false
  if (IGNORED_ITEM_KEYS.has(key)) return false
  return true
}

function extractItemTimings(fullPlayer: any): ItemTiming[] {
  const timings: ItemTiming[] = []

  // Use purchase_log if available (array of {time, key})
  const purchaseLog = fullPlayer?.purchase_log
  if (Array.isArray(purchaseLog)) {
    const seen = new Set<string>()
    for (const entry of purchaseLog) {
      const key = entry.key as string
      if (!key || !isCompletedItem(key)) continue
      if (seen.has(key)) continue
      seen.add(key)
      const dname = itemMap[Object.values(itemMap).indexOf(key) >= 0 ? 0 : 0] // we'll use key directly
      // Convert internal key to display name from first_purchase_time or just capitalise
      timings.push({ item: formatItemKey(key), time: entry.time as number })
    }
  } else {
    // Fallback: use first_purchase_time object
    const fpt = fullPlayer?.first_purchase_time
    if (fpt && typeof fpt === 'object') {
      for (const [key, time] of Object.entries(fpt)) {
        if (!isCompletedItem(key)) continue
        timings.push({ item: formatItemKey(key), time: time as number })
      }
      timings.sort((a, b) => a.time - b.time)
    }
  }
  return timings
}

function formatItemKey(key: string): string {
  // Try to find display name from itemMap
  for (const [, v] of Object.entries(itemMap)) {
    // itemMap is id→dname, but we need key→dname. Search by matching.
  }
  // Fallback: capitalise words and replace underscores
  return key.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
}

function extractKilledBy(fullPlayer: any): Record<string, number> {
  const raw = fullPlayer?.killed_by
  if (!raw || typeof raw !== 'object') return {}
  const result: Record<string, number> = {}
  for (const [key, count] of Object.entries(raw)) {
    // Convert internal key like npc_dota_hero_storm_spirit → hero name
    const heroKey = key.replace('npc_dota_hero_', '')
    const heroId = Object.entries(heroMap).find(([, name]) =>
      name.toLowerCase().replace(/[\s']/g, '_') === heroKey ||
      name.toLowerCase().replace(/[^a-z]/g, '') === heroKey.replace(/_/g, '')
    )
    const displayName = heroId ? heroMap[Number(heroId[0])] : formatItemKey(heroKey)
    result[displayName] = count as number
  }
  return result
}

function extractBenchmarks(fullPlayer: any): LastMatchFull['benchmarks'] {
  const b = fullPlayer?.benchmarks
  if (!b) return null
  return {
    gpmPct: b.gold_per_min?.pct ?? -1,
    xpmPct: b.xp_per_min?.pct ?? -1,
    killsPct: b.kills_per_min?.pct ?? -1,
    lastHitsPct: b.last_hits_per_min?.pct ?? -1,
    heroDmgPct: b.hero_damage_per_min?.pct ?? -1,
    healingPct: b.hero_healing_per_min?.pct ?? -1,
    towerDmgPct: b.tower_damage?.pct ?? -1,
  }
}

function formatTimestamp(seconds: number): string {
  if (seconds < 0) return '-' + formatTimestamp(-seconds)
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

function httpsGet(url: string): Promise<any> {
  return new Promise((resolve) => {
    https.get(url, { headers: { 'User-Agent': 'discord-bot/1.0' } }, (res) => {
        let body = ''
        res.on('data', (chunk: any) => (body += chunk))
        res.on('end', () => { try { resolve(JSON.parse(body)) } catch { resolve(null) } })
      }).on('error', () => resolve(null))
  })
}

function httpsPost(url: string): Promise<any> {
  return new Promise((resolve) => {
    const req = https.request(url, {
      method: 'POST',
      headers: { 'User-Agent': 'discord-bot/1.0' },
    }, (res) => {
      let body = ''
      res.on('data', (chunk: any) => (body += chunk))
      res.on('end', () => { try { resolve(JSON.parse(body)) } catch { resolve(null) } })
    })
    req.on('error', () => resolve(null))
    req.end()
  })
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/** Fetch match data, requesting a parse from OpenDota if ward/observer data is missing */
async function fetchMatchWithParsing(matchId: number): Promise<any> {
  // First attempt – check if already parsed
  let fullMatch = await httpsGet(`${OPENDOTA_API}/matches/${matchId}`)
  if (fullMatch?.version) return fullMatch

  // Request parsing from OpenDota
  await httpsPost(`${OPENDOTA_API}/request/${matchId}`)

  // Poll for parsed data (up to ~25 seconds)
  for (let i = 0; i < 5; i++) {
    await sleep(5000)
    fullMatch = await httpsGet(`${OPENDOTA_API}/matches/${matchId}`)
    if (fullMatch?.version) return fullMatch
  }

  return fullMatch // return whatever we have (unparsed)
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
    const trimmed = args.trim()

    // If no args provided, look up the command author's own Steam ID
    let resolved: { steamId: string; displayName: string } | null = null
    if (!trimmed) {
      const authorName = message.author.username
      const steamId = DISCORD_TO_STEAM[authorName]
        ?? DISCORD_TO_STEAM[Object.keys(DISCORD_TO_STEAM).find(k => k.toLowerCase() === authorName.toLowerCase()) ?? '']
      if (steamId) {
        resolved = { steamId, displayName: message.member?.displayName ?? authorName }
      }
    } else {
      resolved = resolveSteamId(message, trimmed)
    }

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
        // Check if the player has match data exposure disabled
        const profile = await httpsGet(`${OPENDOTA_API}/players/${accountId}`)
        if (profile?.profile?.account_id && profile?.profile?.fh_unavailable === true) {
          message.reply(t('match.noDataExposed', { name: displayName ?? `Steam ${accountId}` }))
        } else {
          message.reply(t('match.noRecent'))
        }
        return
      }

      const matches = recent.slice(0, RECENT_MATCH_COUNT)
      const agg = computeAggregate(matches)
      const m = matches[0]

      // Fetch full match details with parsing for rich data
      await loadItemMap()
      const fullMatch = await fetchMatchWithParsing(m.match_id)
      const fullPlayer = fullMatch?.players?.find(
        (p: any) => p.account_id === Number(accountId)
      )
      const isParsed = !!fullMatch?.version

      const denies: number = fullPlayer?.denies ?? 0
      const level: number  = fullPlayer?.level  ?? 0
      const netWorth: number = fullPlayer?.net_worth ?? 0

      const isRadiant = m.player_slot < 128
      const won = (isRadiant && m.radiant_win) || (!isRadiant && !m.radiant_win)
      const hero = heroName(m.hero_id)
      const kda = m.deaths === 0 ? m.kills + m.assists : (m.kills + m.assists) / m.deaths
      const playerName = await fetchDotaNick(accountId, displayName ?? `Steam ${accountId}`)

      // Collect items (slots 0-5)
      const rawItems: string[] = []
      if (fullPlayer) {
        for (let i = 0; i <= 5; i++) {
          const id = fullPlayer[`item_${i}`] as number
          const name = itemName(id)
          if (name) rawItems.push(name)
        }
      }
      const itemList = rawItems.length > 0 ? rawItems.join(', ') : ''

      // Detect position, extract parsed data
      const position = isParsed
        ? detectPosition(fullMatch, fullPlayer, m.player_slot)
        : (fullPlayer?.lane_role ?? 0)
      const posLabel = positionLabel(position)

      const obsPlaced   = isParsed ? (fullPlayer?.obs_placed    ?? 0) : -1
      const senPlaced   = isParsed ? (fullPlayer?.sen_placed    ?? 0) : -1
      const campsStacked = isParsed ? (fullPlayer?.camps_stacked ?? 0) : -1

      const itemTimings = isParsed ? extractItemTimings(fullPlayer) : []
      const killedByMap = isParsed ? extractKilledBy(fullPlayer) : {}
      const benchmarks = extractBenchmarks(fullPlayer)

      let nemesis: { hero: string; count: number } | null = null
      const kbEntries = Object.entries(killedByMap)
      if (kbEntries.length > 0) {
        const [nemHero, nemCount] = kbEntries.sort((a, b) => b[1] - a[1])[0]
        nemesis = { hero: nemHero, count: nemCount }
      }

      const teamfightParticipation = isParsed ? (fullPlayer?.teamfight_participation ?? 0) : -1
      const laneEfficiency = isParsed ? (fullPlayer?.lane_efficiency_pct ?? 0) : -1
      const timeSpentDead = isParsed ? (fullPlayer?.life_state_dead ?? 0) : -1
      const stunSeconds = isParsed ? (fullPlayer?.stuns ?? 0) : -1
      const buybackCount = fullPlayer?.buyback_count ?? 0
      const sentryKills = isParsed ? (fullPlayer?.sentry_kills ?? 0) : -1
      const observerKills = isParsed ? (fullPlayer?.observer_kills ?? 0) : -1

      const winRate = Math.round(agg.wins / agg.total * 100)

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
        xpm: m.xp_per_min,
        heroDamage: m.hero_damage ?? 0,
        towerDamage: m.tower_damage ?? 0,
        lastHits: fullPlayer?.last_hits ?? m.last_hits ?? 0,
        denies,
        netWorth,
        level,
        duration: m.duration,
        isTurbo: m.game_mode === 23,
        gameMode: GAME_MODES[m.game_mode] ?? 'Unknown',
        positionLabel: posLabel,
        position,
        items: rawItems,
        winRate,
        avgDeaths: agg.avgDeaths,
        avgKDA: agg.avgKDA,
        favHero: agg.favouriteHero,
        streak: agg.currentStreak,
        total: agg.total,
        obsPlaced,
        senPlaced,
        campsStacked,
        itemTimings,
        killedBy: killedByMap,
        nemesis,
        benchmarks,
        teamfightParticipation,
        laneEfficiency,
        timeSpentDead,
        stunSeconds,
        buybackCount,
        sentryKills,
        observerKills,
        isParsed,
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
          { name: '📌 Position', value: posLabel, inline: true },
          { name: t('match.fieldLastHits'), value: `${fullPlayer?.last_hits ?? m.last_hits ?? 0} / ${denies}`, inline: true },
          { name: '💸 Net Worth', value: netWorth.toLocaleString(), inline: true },
          { name: t('match.fieldHeroDmg'), value: (m.hero_damage ?? 0).toLocaleString(), inline: true },
          { name: t('match.fieldTowerDmg'), value: (m.tower_damage ?? 0).toLocaleString(), inline: true },
          { name: t('match.fieldHealing'), value: (m.hero_healing ?? 0).toLocaleString(), inline: true },
          { name: t('match.fieldLevel'), value: `${level || '-'}`, inline: true },
          { name: t('match.fieldMode'), value: GAME_MODES[m.game_mode] ?? 'Unknown', inline: true },
        )

      // Items
      if (itemList)
        embed.addFields({ name: '🛡️ Items', value: itemList, inline: false })

      // Item timings (top 6)
      if (itemTimings.length > 0) {
        const timingDisplay = itemTimings.slice(0, 6).map(t => {
          const tm = Math.floor(t.time / 60)
          const ts = (t.time % 60).toString().padStart(2, '0')
          return `${t.item} @ ${tm}:${ts}`
        }).join('\n')
        embed.addFields({ name: '🕐 Item Timings', value: timingDisplay, inline: false })
      }

      // Wards & dewarding
      if (obsPlaced >= 0) {
        const wardLine = `👁 ${obsPlaced} obs  |  🔴 ${senPlaced} sen  |  🏕 ${campsStacked} stacks`
          + (isParsed ? `  |  🔍 ${sentryKills} sen killed  |  ${observerKills} obs killed` : '')
        embed.addFields({ name: '👁️ Wards / Stacks', value: wardLine, inline: false })
      }

      // Nemesis
      if (nemesis)
        embed.addFields({ name: '☠️ Nemesis', value: `💀 ${nemesis.hero} (${nemesis.count}x)`, inline: true })

      // Benchmarks
      if (benchmarks) {
        const benchDisplay = [
          `GPM: top ${Math.round(benchmarks.gpmPct * 100)}%`,
          `XPM: top ${Math.round(benchmarks.xpmPct * 100)}%`,
          `Kills: top ${Math.round(benchmarks.killsPct * 100)}%`,
          `LH: top ${Math.round(benchmarks.lastHitsPct * 100)}%`,
          `Dmg: top ${Math.round(benchmarks.heroDmgPct * 100)}%`,
        ].join(' | ')
        embed.addFields({ name: '📊 Benchmarks vs other ' + hero, value: benchDisplay, inline: false })
      }

      // Advanced parsed stats
      const advancedLines: string[] = []
      if (teamfightParticipation >= 0)
        advancedLines.push(`⚔️ TF: ${Math.round(teamfightParticipation * 100)}%`)
      if (laneEfficiency >= 0)
        advancedLines.push(`🏠 Lane: ${laneEfficiency}%`)
      if (timeSpentDead >= 0)
        advancedLines.push(`⏱️ Dead: ${timeSpentDead}s`)
      if (stunSeconds >= 0)
        advancedLines.push(`🔨 Stuns: ${stunSeconds.toFixed(1)}s`)
      if (buybackCount > 0)
        advancedLines.push(`💰 BB: ${buybackCount}`)
      if (advancedLines.length > 0)
        embed.addFields({ name: '📈 Advanced', value: advancedLines.join('  |  '), inline: false })

      // Trend
      embed.addFields(
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

  /**
   * !resumedoday / !resumedolastday
   * Fetches recent matches for ALL mapped users, filters by the target day,
   * and posts a summary of wins/losses per player.
   */
  static async daySummary(message: Message, mode: 'today' | 'yesterday') {
    try {
      await (message.channel as any).sendTyping?.()
      await loadHeroMap()

      const dayLabel = mode === 'today' ? t('resume.today') : t('resume.yesterday')
      message.channel.send(t('resume.fetching'))

      // Determine the target day boundaries (in local time / UTC)
      const now = new Date()
      const targetDate = new Date(now)
      if (mode === 'yesterday') {
        targetDate.setDate(targetDate.getDate() - 1)
      }
      const dayStart = new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate(), 0, 0, 0)
      const dayEnd = new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate(), 23, 59, 59)
      const dayStartUnix = Math.floor(dayStart.getTime() / 1000)
      const dayEndUnix = Math.floor(dayEnd.getTime() / 1000)

      interface PlayerResult {
        name: string
        wins: number
        losses: number
        total: number
      }

      const results: PlayerResult[] = []

      // Fetch matches for each mapped user
      for (const [discordName, steamId] of Object.entries(DISCORD_TO_STEAM)) {
        try {
          const playerName = await fetchDotaNick(steamId, discordName)
          const recent: RecentMatch[] = await httpsGet(
            `${OPENDOTA_API}/players/${steamId}/recentMatches`
          )
          if (!recent || !Array.isArray(recent) || recent.length === 0) continue

          // Filter matches that started within the target day
          const dayMatches = recent.filter(m => {
            return m.start_time >= dayStartUnix && m.start_time <= dayEndUnix
          })

          if (dayMatches.length === 0) continue

          let wins = 0
          let losses = 0
          for (const m of dayMatches) {
            const isRadiant = m.player_slot < 128
            const won = (isRadiant && m.radiant_win) || (!isRadiant && !m.radiant_win)
            if (won) wins++
            else losses++
          }

          results.push({ name: playerName, wins, losses, total: dayMatches.length })
        } catch (err) {
          console.warn(`[DaySummary] Failed to fetch for ${discordName}:`, err)
        }
      }

      if (results.length === 0) {
        message.channel.send(t('resume.noMatches', { day: dayLabel }))
        return
      }

      // Sort by total matches descending, then by wins descending
      results.sort((a, b) => b.total - a.total || b.wins - a.wins)

      const totalWins = results.reduce((s, r) => s + r.wins, 0)
      const totalLosses = results.reduce((s, r) => s + r.losses, 0)
      const totalMatches = results.reduce((s, r) => s + r.total, 0)

      const lines = results.map(r => {
        const winRate = r.total > 0 ? Math.round((r.wins / r.total) * 100) : 0
        let icon = '⚪'
        if (r.wins > r.losses) icon = '🟢'
        else if (r.losses > r.wins) icon = '🔴'
        else if (r.total > 0) icon = '🟡'
        return t('resume.playerLine', { icon, name: r.name, wins: r.wins, losses: r.losses, total: r.total })
      })

      const totalLine = t('resume.totalLine', { wins: totalWins, losses: totalLosses, total: totalMatches })

      const embed = new EmbedBuilder()
        .setColor(totalWins >= totalLosses ? 0x57f287 : 0xed4245)
        .setTitle(t('resume.title', { day: dayLabel }))
        .setDescription(lines.join('\n') + '\n\n' + totalLine)
        .setFooter({ text: t('resume.footer') })
        .setTimestamp()

      message.channel.send({ embeds: [embed] })
    } catch (err: any) {
      console.error('[DaySummary] Error:', err?.message ?? err)
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

  /** Exported for RoastHandler: returns full last match data (items, position, etc.) */
  static async fetchLastMatchFull(accountId: string): Promise<LastMatchFull | null> {
    try {
      await loadHeroMap()
      await loadItemMap()

      const recent: RecentMatch[] = await httpsGet(
        `${OPENDOTA_API}/players/${accountId}/recentMatches`
      )
      if (!recent || recent.length === 0) return null

      const matches = recent.slice(0, RECENT_MATCH_COUNT)
      const agg = computeAggregate(matches)
      const m = matches[0]

      // Fetch full match details for items, lane role, net worth, obs/sen etc.
      // Uses fetchMatchWithParsing to request a parse from OpenDota if needed,
      // so that ward/observer data (obs_placed, sen_placed, camps_stacked) is available.
      const fullMatch = await fetchMatchWithParsing(m.match_id)
      const fullPlayer = fullMatch?.players?.find(
        (p: any) => p.account_id === Number(accountId)
      )

      const isParsed = !!fullMatch?.version

      const isRadiant = m.player_slot < 128
      const won = (isRadiant && m.radiant_win) || (!isRadiant && !m.radiant_win)
      const hero = heroName(m.hero_id)
      const kda = m.deaths === 0
        ? m.kills + m.assists
        : (m.kills + m.assists) / m.deaths

      // Collect items (slots 0-5)
      const rawItems: string[] = []
      if (fullPlayer) {
        for (let i = 0; i <= 5; i++) {
          const id = fullPlayer[`item_${i}`] as number
          const name = itemName(id)
          if (name) rawItems.push(name)
        }
      }

      // Ward/stack data is only available in parsed matches.
      // Use -1 to signal "data not available" so callers can show N/A instead of 0.
      const obsPlaced  = isParsed ? (fullPlayer?.obs_placed   ?? 0) : -1
      const senPlaced  = isParsed ? (fullPlayer?.sen_placed   ?? 0) : -1
      const campsStacked = isParsed ? (fullPlayer?.camps_stacked ?? 0) : -1

      // Detect actual Dota position (1-5) by team net worth ranking
      const position = isParsed
        ? detectPosition(fullMatch, fullPlayer, m.player_slot)
        : (fullPlayer?.lane_role ?? 0)

      // Extract rich parsed data
      const itemTimings = isParsed ? extractItemTimings(fullPlayer) : []
      const killedBy = isParsed ? extractKilledBy(fullPlayer) : {}
      const benchmarks = extractBenchmarks(fullPlayer)

      // Nemesis: who killed this player the most
      let nemesis: LastMatchFull['nemesis'] = null
      const killedByEntries = Object.entries(killedBy)
      if (killedByEntries.length > 0) {
        const [nemHero, nemCount] = killedByEntries.sort((a, b) => b[1] - a[1])[0]
        nemesis = { hero: nemHero, count: nemCount }
      }

      return {
        matchId: m.match_id,
        hero,
        kills: m.kills,
        deaths: m.deaths,
        assists: m.assists,
        kda: Math.round(kda * 10) / 10,
        gpm: m.gold_per_min,
        xpm: m.xp_per_min,
        heroDamage: m.hero_damage ?? 0,
        towerDamage: m.tower_damage ?? 0,
        heroHealing: m.hero_healing ?? 0,
        lastHits: fullPlayer?.last_hits ?? m.last_hits ?? 0,
        denies: fullPlayer?.denies ?? 0,
        netWorth: fullPlayer?.net_worth ?? 0,
        level: fullPlayer?.level ?? 0,
        duration: m.duration,
        won,
        isTurbo: m.game_mode === 23,
        gameMode: GAME_MODES[m.game_mode] ?? 'Unknown',
        laneRole: laneRoleName(fullPlayer?.lane_role ?? 0),
        laneRoleId: fullPlayer?.lane_role ?? 0,
        position,
        positionLabel: positionLabel(position),
        items: rawItems,
        obsPlaced,
        senPlaced,
        campsStacked,
        startTime: m.start_time,
        // Rich parsed data
        itemTimings,
        killedBy,
        nemesis,
        benchmarks,
        teamfightParticipation: isParsed ? (fullPlayer?.teamfight_participation ?? 0) : -1,
        laneEfficiency: isParsed ? (fullPlayer?.lane_efficiency_pct ?? 0) : -1,
        timeSpentDead: isParsed ? (fullPlayer?.life_state_dead ?? 0) : -1,
        stunSeconds: isParsed ? (fullPlayer?.stuns ?? 0) : -1,
        buybackCount: fullPlayer?.buyback_count ?? 0,
        apm: isParsed ? (fullPlayer?.actions_per_min ?? 0) : -1,
        sentryKills: isParsed ? (fullPlayer?.sentry_kills ?? 0) : -1,
        observerKills: isParsed ? (fullPlayer?.observer_kills ?? 0) : -1,
        courierKills: isParsed ? (fullPlayer?.courier_kills ?? 0) : -1,
        runePickups: isParsed ? (fullPlayer?.rune_pickups ?? 0) : -1,
        isParsed,
        agg,
      }
    } catch {
      return null
    }
  }
}
