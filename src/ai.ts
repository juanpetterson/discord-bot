import OpenAI from 'openai'

// \u2500\u2500\u2500 Groq setup \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
// Set GROQ_API_KEY in your .env - get a free key at https://console.groq.com
//
// Model: llama-3.3-70b-versatile (free tier: ~14,400 req/day, 30 RPM)

const MODEL_NAME = 'llama-3.3-70b-versatile'

function getClient() {
  const apiKey = process.env.GROQ_API_KEY ?? ''
  if (!apiKey) return null
  return new OpenAI({
    apiKey,
    baseURL: 'https://api.groq.com/openai/v1',
  })
}

/**
 * Ask Groq (Llama 3.3 70B) to generate text for the given prompt.
 * Returns null if GROQ_API_KEY is not set or the request fails,
 * so callers fall back to hardcoded responses.
 */
export async function askAI(prompt: string, maxTokens = 300, temperature = 1.2): Promise<string | null> {
  const client = getClient()
  if (!client) {
    console.warn('[AI] GROQ_API_KEY not set - using fallback commentary.')
    return null
  }
  try {
    const chat = await client.chat.completions.create({
      model: MODEL_NAME,
      temperature,
      top_p: 0.95,
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: prompt }],
    })
    return chat.choices[0]?.message?.content?.trim() || null
  } catch (err: any) {
    console.error('[AI] Groq request failed:', err?.message ?? err)
    return null
  }
}

// \u2500\u2500\u2500 Prompt builders \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

/**
 * Prompt for AI-powered hero draft assignment.
 * Asks the model to pick one hero per role per team with no duplicates.
 * Expects a JSON response: { "teamA": ["Hero1",...], "teamB": ["Hero1",...] }
 */
export function heroPickPrompt(opts: {
  size: number
  roles: string[]
  heroPool: { localized_name: string; roles: string[] }[]
}): string {
  const { size, roles, heroPool } = opts

  // Group available heroes compactly by their most relevant Dota role
  const byRole: Record<string, string[]> = {
    Carry: [], Mid: [], Offlane: [], 'Soft Support': [], 'Hard Support': [],
  }
  for (const h of heroPool) {
    const r = h.roles
    if (r.includes('Carry') && !r.includes('Support'))         byRole['Carry'].push(h.localized_name)
    else if (r.includes('Nuker') && !r.includes('Support'))   byRole['Mid'].push(h.localized_name)
    else if (r.includes('Initiator') && !r.includes('Support')) byRole['Offlane'].push(h.localized_name)
    else if (r.includes('Support') && r.includes('Disabler')) byRole['Soft Support'].push(h.localized_name)
    else if (r.includes('Support'))                            byRole['Hard Support'].push(h.localized_name)
    else                                                       byRole['Carry'].push(h.localized_name)
  }

  const poolLines = Object.entries(byRole)
    .filter(([, heroes]) => heroes.length > 0)
    .map(([role, heroes]) => `${role}: ${heroes.join(', ')}`)
    .join('\n')

  const roleList = roles.map((r, i) => `${i + 1}. ${r}`).join('\n')
  const seed = Math.random().toString(16).slice(2, 8)

  return `You are a Dota 2 expert drafter. Assign heroes for a ${size}v${size} match.

Each team needs exactly ${roles.length} heroes, one per role in this order:
${roleList}

Available hero pool (grouped by primary function):
${poolLines}

Rules:
- Pick heroes genuinely suitable for each role (e.g. Anti-Mage for Hard Carry, Crystal Maiden for Hard Support)
- No hero may appear more than once across both teams
- Only use hero names exactly as written in the pool above
- Vary the picks across drafts — avoid defaulting to the most popular meta heroes; mix in less common picks from the pool

Variability seed: ${seed}

Respond with ONLY valid JSON, no explanation, no markdown:
{"teamA":["Hero1","Hero2"...],"teamB":["Hero1","Hero2"...]}`
}

/** Prompt for match commentary (2-3 sentences, witty) — includes rich parsed data */
export function matchCommentaryPrompt(opts: {
  lang: 'pt-br' | 'en-us'
  name: string
  hero: string
  kills: number
  deaths: number
  assists: number
  kda: number
  won: boolean
  gpm: number
  xpm: number
  heroDamage: number
  towerDamage: number
  lastHits: number
  denies: number
  netWorth: number
  level: number
  duration: number
  isTurbo: boolean
  gameMode: string
  positionLabel: string
  position: number
  items: string[]
  winRate: number
  avgDeaths: number
  avgKDA: number
  favHero: string
  streak: number
  total: number
  // Rich parsed data
  obsPlaced: number
  senPlaced: number
  campsStacked: number
  itemTimings: { item: string; time: number }[]
  killedBy: Record<string, number>
  nemesis: { hero: string; count: number } | null
  benchmarks: {
    gpmPct: number; xpmPct: number; killsPct: number
    lastHitsPct: number; heroDmgPct: number; towerDmgPct: number
  } | null
  teamfightParticipation: number
  laneEfficiency: number
  timeSpentDead: number
  stunSeconds: number
  buybackCount: number
  sentryKills: number
  observerKills: number
  isParsed: boolean
}): string {
  const { lang, name, hero, kills, deaths, assists, kda, won, gpm, xpm, heroDamage,
    towerDamage, lastHits, denies, netWorth, level, duration, isTurbo, gameMode,
    positionLabel, position, items,
    winRate, avgDeaths, avgKDA, favHero, streak, total,
    obsPlaced, senPlaced, campsStacked, itemTimings, killedBy, nemesis, benchmarks,
    teamfightParticipation, laneEfficiency, timeSpentDead, stunSeconds,
    buybackCount, sentryKills, observerKills, isParsed } = opts

  const mins = Math.floor(duration / 60)
  const itemList = items.length > 0 ? items.join(', ') : 'no items recorded'
  const streakStr = streak > 0
    ? `${streak}-win streak`
    : streak < 0
    ? `${Math.abs(streak)}-loss streak`
    : 'no current streak'

  const isSupport = position >= 4
  const isCore = position >= 1 && position <= 3

  // Item timings
  const itemTimingStr = itemTimings.length > 0
    ? itemTimings.slice(0, 6).map(t => `${t.item} at ${Math.floor(t.time / 60)}:${(t.time % 60).toString().padStart(2, '0')}`).join(', ')
    : 'not available'

  // Killed-by breakdown
  const killedByStr = Object.keys(killedBy).length > 0
    ? Object.entries(killedBy).sort((a, b) => b[1] - a[1]).map(([h, c]) => `${h} (${c}x)`).join(', ')
    : 'not available'

  // Benchmarks
  const benchStr = benchmarks
    ? `GPM: top ${Math.round(benchmarks.gpmPct * 100)}%, XPM: top ${Math.round(benchmarks.xpmPct * 100)}%, Kills: top ${Math.round(benchmarks.killsPct * 100)}%, LH: top ${Math.round(benchmarks.lastHitsPct * 100)}%, Dmg: top ${Math.round(benchmarks.heroDmgPct * 100)}%`
    : 'not available'

  const langInstruction = lang === 'pt-br'
    ? 'Responda APENAS em portugu\u00eas brasileiro. Use g\u00edrias de jogador de Dota brasileiro.'
    : 'Respond ONLY in English. Use gamer slang.'

  return `You are a sharp, witty Dota 2 commentator and analyst. ${langInstruction}

Write 2-4 sentences of punchy, insightful commentary about this player's last match. Be specific to the numbers. Can be funny, impressed, analytical, or mocking — match the mood to the performance. Reference specific data points like item timings, nemesis, benchmarks when available. No headers, no labels, no markdown, just plain text.

Analysis context:
- POSITION: ${positionLabel}. Judge everything relative to this role.
- ITEM BUILD: ${itemList}${itemTimingStr !== 'not available' ? `. Key timings: ${itemTimingStr}` : ''}
- WARDS: ${obsPlaced < 0 ? 'not parsed' : `${obsPlaced} obs, ${senPlaced} sen placed`}${isParsed ? `, dewarded: ${sentryKills} sen, ${observerKills} obs` : ''}
- CAMPS STACKED: ${campsStacked < 0 ? 'not parsed' : campsStacked}
- DEATHS: ${killedByStr !== 'not available' ? `Killed by: ${killedByStr}` : ''}${nemesis ? ` — nemesis: ${nemesis.hero} killed them ${nemesis.count} times` : ''}
- BENCHMARKS vs other ${hero} players: ${benchStr}
- TEAMFIGHT: ${teamfightParticipation >= 0 ? `${Math.round(teamfightParticipation * 100)}% participation` : 'N/A'}
- LANE: ${laneEfficiency >= 0 ? `${laneEfficiency}% efficiency` : 'N/A'}
- TIME DEAD: ${timeSpentDead >= 0 ? `${timeSpentDead}s (${Math.round(timeSpentDead / duration * 100)}% of game)` : 'N/A'}
- STUNS: ${stunSeconds >= 0 ? `${stunSeconds.toFixed(1)}s applied` : 'N/A'}
- BUYBACKS: ${buybackCount}
- ${isTurbo ? 'TURBO match' : 'Normal match'}

Player: ${name}
Hero: ${hero} (${positionLabel})
Game mode: ${gameMode}${isTurbo ? ' (TURBO)' : ''}
Result: ${won ? 'WIN' : 'LOSS'} in ${mins} minutes
Score: ${kills}/${deaths}/${assists} (${kda.toFixed(1)} KDA)
GPM: ${gpm} | XPM: ${xpm} | Net worth: ${netWorth.toLocaleString()}
Hero damage: ${heroDamage.toLocaleString()} | Tower damage: ${towerDamage.toLocaleString()}
Last hits: ${lastHits} | Denies: ${denies} | Level: ${level}
Recent ${total} games: ${winRate}% winrate, avg ${avgDeaths} deaths/game, avg ${avgKDA} KDA, favourite hero ${favHero}, ${streakStr}`
}

/** Prompt for a deep roast of the player's last single match (items, position, performance) */
export function roastLastMatchPrompt(opts: {
  lang: 'pt-br' | 'en-us'
  name: string
  hero: string
  kills: number
  deaths: number
  assists: number
  kda: number
  gpm: number
  xpm: number
  heroDamage: number
  towerDamage: number
  lastHits: number
  denies: number
  netWorth: number
  level: number
  duration: number
  won: boolean
  isTurbo: boolean
  gameMode: string
  laneRole: string
  positionLabel: string
  position: number
  items: string[]
  obsPlaced: number
  senPlaced: number
  campsStacked: number
  avgDeaths: number
  avgKDA: number
  winRate: number
  streak: number
  total: number
  // Rich parsed data
  itemTimings: { item: string; time: number }[]
  killedBy: Record<string, number>
  nemesis: { hero: string; count: number } | null
  benchmarks: {
    gpmPct: number; xpmPct: number; killsPct: number
    lastHitsPct: number; heroDmgPct: number; towerDmgPct: number
  } | null
  teamfightParticipation: number
  laneEfficiency: number
  timeSpentDead: number
  stunSeconds: number
  buybackCount: number
  sentryKills: number
  observerKills: number
  courierKills: number
  isParsed: boolean
}): string {
  const {
    lang, name, hero, kills, deaths, assists, kda, gpm, xpm,
    heroDamage, towerDamage, lastHits, denies, netWorth, level,
    duration, won, isTurbo, gameMode, laneRole, positionLabel, position, items,
    obsPlaced, senPlaced, campsStacked, avgDeaths, avgKDA,
    winRate, streak, total,
    itemTimings, killedBy, nemesis, benchmarks,
    teamfightParticipation, laneEfficiency, timeSpentDead, stunSeconds,
    buybackCount, sentryKills, observerKills, courierKills, isParsed,
  } = opts

  const mins = Math.floor(duration / 60)
  const itemList = items.length > 0 ? items.join(', ') : 'no items recorded'
  const streakStr = streak > 0
    ? `${streak}-win streak`
    : streak < 0
    ? `${Math.abs(streak)}-loss streak`
    : 'no current streak'
  const isSupport = position >= 4
  const isCore = position <= 3 && position >= 1

  // Format item timings
  const itemTimingStr = itemTimings.length > 0
    ? itemTimings.slice(0, 8).map(t => `${t.item} at ${Math.floor(t.time / 60)}:${(t.time % 60).toString().padStart(2, '0')}`).join(', ')
    : 'not available'

  // Format killed-by breakdown
  const killedByStr = Object.keys(killedBy).length > 0
    ? Object.entries(killedBy).sort((a, b) => b[1] - a[1]).map(([h, c]) => `${h} (${c}x)`).join(', ')
    : 'not available'

  // Format benchmarks
  const benchStr = benchmarks
    ? `GPM: top ${Math.round((benchmarks.gpmPct) * 100)}%, XPM: top ${Math.round((benchmarks.xpmPct) * 100)}%, Kills: top ${Math.round((benchmarks.killsPct) * 100)}%, Last hits: top ${Math.round((benchmarks.lastHitsPct) * 100)}%, Hero damage: top ${Math.round((benchmarks.heroDmgPct) * 100)}%`
    : 'not available'

  const langInstruction = lang === 'pt-br'
    ? 'Responda APENAS em portugu\u00eas brasileiro. Use g\u00edrias e humor t\u00edpico de jogadores brasileiros de Dota.'
    : 'Respond ONLY in English. Use gamer slang and dark humour.'

  return `You are a savage but expert Dota 2 analyst and roast comedian. ${langInstruction}

Analyze this player's last match in depth and roast them. Consider ALL of the following:
- POSITION CONTEXT: This player was ${positionLabel} (detected by net worth ranking). Judge items, farm, and performance FOR THIS ROLE specifically.
- Was the item build appropriate for ${hero} as ${positionLabel}? (e.g. carries need BKB in most games, supports should have Glimmer/Force, offlaners need utility/aura items)
- ITEM TIMING: Were their key items purchased at reasonable times? ${itemTimingStr !== 'not available' ? `Their item timings: ${itemTimingStr}. For a ${positionLabel}, judge if these are fast, slow, or average.` : 'Item timing data not available.'}
- KDA: Was ${kills}/${deaths}/${assists} acceptable for a ${positionLabel}? (pos 5 dying more is normal, pos 1/2 feeding is inexcusable)
- GPM: Is ${gpm} GPM good for a ${positionLabel}? (pos 1 needs 500+, pos 5 is fine with 200-300)
- WARDS: ${obsPlaced < 0 ? 'Ward data not available (match not parsed) — skip ward analysis' : `${obsPlaced} obs, ${senPlaced} sentries placed. ${isSupport ? 'As a support, ward placement matters!' : 'Not a support, but buying a few wards is still good.'}`}
- DEWARDING: ${isParsed ? `Destroyed ${sentryKills} enemy sentries, ${observerKills} enemy observers. ${isSupport && sentryKills === 0 && observerKills === 0 ? 'A support that never dewards is barely a support.' : ''}` : 'Data not available.'}
- CAMPS STACKED: ${campsStacked < 0 ? 'Data not available' : `${campsStacked} camps stacked. ${isSupport && campsStacked === 0 ? 'Support with 0 stacks is lazy.' : ''}`}
- DEATHS: ${killedByStr !== 'not available' ? `Killed by: ${killedByStr}. ${nemesis ? `Nemesis: ${nemesis.hero} killed them ${nemesis.count} times — roast the repeated deaths to the same hero!` : ''}` : 'Death breakdown not available.'}
- BENCHMARKS vs other ${hero} players: ${benchStr}${benchmarks ? ` — if below top 50% in key stats, roast them for being worse than average on their own hero` : ''}
- TEAMFIGHT: ${teamfightParticipation >= 0 ? `${Math.round(teamfightParticipation * 100)}% teamfight participation. ${teamfightParticipation < 0.3 ? 'Missing most teamfights is unacceptable.' : teamfightParticipation > 0.8 ? 'At least they showed up to fights.' : ''}` : 'Not available.'}
- LANE: ${laneEfficiency >= 0 ? `${laneEfficiency}% lane efficiency. ${laneEfficiency < 50 && isCore ? 'Terrible laning for a core.' : ''}` : 'Not available.'}
- TIME DEAD: ${timeSpentDead >= 0 ? `Spent ${timeSpentDead} seconds dead (${Math.round(timeSpentDead / duration * 100)}% of the game). ${timeSpentDead > duration * 0.25 ? 'Spent more time dead than some players spend in the whole match.' : ''}` : 'Not available.'}
- BUYBACKS: ${buybackCount > 0 ? `Used ${buybackCount} buyback(s). ${buybackCount >= 3 ? 'Desperate buyback spam.' : ''}` : 'No buybacks.'}
- ${isTurbo ? 'THIS IS A TURBO MATCH — mock them for playing Turbo if stats are bad' : 'This is a normal match'}
- STUNS: ${stunSeconds >= 0 ? `Applied ${stunSeconds.toFixed(1)}s of stuns. ${isSupport && stunSeconds < 10 ? 'Support barely stunning anyone.' : ''}` : 'Not available.'}
- COURIER KILLS: ${courierKills > 0 ? `Killed ${courierKills} courier(s) — nice.` : ''}
- Last hits (${lastHits}) vs denies (${denies}) — critical for mid/carry
- If the match was genuinely impressive, acknowledge it briefly but still find something to tease
- Reference SPECIFIC item names and timings from their build when roasting

Write 4-6 punchy roast lines. Be specific, creative, and expert-level. No headers, no bullet points, no markdown. Plain text only.

Player: ${name}
Hero: ${hero}
Position: ${positionLabel} (played ${laneRole})
Game mode: ${gameMode}${isTurbo ? ' (TURBO \ud83e\udd21)' : ''}
Result: ${won ? 'WIN' : 'LOSS'}
Duration: ${mins} minutes
Score: ${kills}/${deaths}/${assists} (KDA ${kda.toFixed(1)})
GPM: ${gpm} | XPM: ${xpm}
Hero damage: ${heroDamage.toLocaleString()} | Tower damage: ${towerDamage.toLocaleString()}
Last hits: ${lastHits} | Denies: ${denies}
Net worth: ${netWorth.toLocaleString()}
Level at end: ${level}
Items: ${itemList}
Item timings: ${itemTimingStr}
Wards placed: ${obsPlaced >= 0 ? `${obsPlaced} obs, ${senPlaced} sen` : 'N/A'} | Dewarded: ${isParsed ? `${sentryKills} sen, ${observerKills} obs` : 'N/A'}
Camps stacked: ${campsStacked >= 0 ? campsStacked : 'N/A'}
Killed by: ${killedByStr}${nemesis ? ` (nemesis: ${nemesis.hero} ${nemesis.count}x)` : ''}
Benchmarks: ${benchStr}
Teamfight participation: ${teamfightParticipation >= 0 ? Math.round(teamfightParticipation * 100) + '%' : 'N/A'}
Lane efficiency: ${laneEfficiency >= 0 ? laneEfficiency + '%' : 'N/A'}
Time spent dead: ${timeSpentDead >= 0 ? timeSpentDead + 's' : 'N/A'}
Stun applied: ${stunSeconds >= 0 ? stunSeconds.toFixed(1) + 's' : 'N/A'}
Buybacks: ${buybackCount}
Recent ${total} games context: ${winRate}% winrate, avg ${avgDeaths} deaths/game, avg ${avgKDA} KDA, ${streakStr}`
}

/** Prompt for a roast (3-5 savage lines based on real stats) */
export function roastPrompt(opts: {
  lang: 'pt-br' | 'en-us'
  name: string
  wins: number
  total: number
  avgDeaths: number
  avgKDA: number
  favHero: string
  streak: number
  worstDeaths: number
  feedGames: number
}): string {
  const { lang, name, wins, total, avgDeaths, avgKDA, favHero,
    streak, worstDeaths, feedGames } = opts

  const winRate = Math.round((wins / total) * 100)
  const streakStr = streak > 0
    ? `${streak}-win streak`
    : streak < 0
    ? `${Math.abs(streak)}-loss streak`
    : 'no streak'

  const langInstruction = lang === 'pt-br'
    ? 'Responda APENAS em portugu\u00eas brasileiro. Use g\u00edrias e humor t\u00edpico de jogadores brasileiros de Dota.'
    : 'Respond ONLY in English. Use gamer slang and dark humour.'

  return `You are a savage but genuinely funny Dota 2 roast comedian. ${langInstruction}

Write 3-5 short roast lines about this player using their REAL stats as ammunition. Each line should be a standalone jab \u2014 specific, creative, and punchy. No headers, no labels, no markdown, no bullet points, just plain text lines.

Player: ${name}
Stats (last ${total} games): ${wins}W/${total - wins}L (${winRate}% winrate), avg ${avgDeaths} deaths/game, avg ${avgKDA} KDA, favourite hero: ${favHero}, current streak: ${streakStr}, worst single game: ${worstDeaths} deaths, games with 10+ deaths: ${feedGames}`
}
