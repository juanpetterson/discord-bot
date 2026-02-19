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
export async function askAI(prompt: string): Promise<string | null> {
  const client = getClient()
  if (!client) {
    console.warn('[AI] GROQ_API_KEY not set - using fallback commentary.')
    return null
  }
  try {
    const chat = await client.chat.completions.create({
      model: MODEL_NAME,
      temperature: 1.2,
      top_p: 0.95,
      max_tokens: 300,
      messages: [{ role: 'user', content: prompt }],
    })
    return chat.choices[0]?.message?.content?.trim() || null
  } catch (err: any) {
    console.error('[AI] Groq request failed:', err?.message ?? err)
    return null
  }
}

// \u2500\u2500\u2500 Prompt builders \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

/** Prompt for match commentary (2-3 sentences, witty) */
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
  heroDamage: number
  winRate: number
  avgDeaths: number
  avgKDA: number
  favHero: string
  streak: number
  total: number
}): string {
  const { lang, name, hero, kills, deaths, assists, kda, won, gpm, heroDamage,
    winRate, avgDeaths, avgKDA, favHero, streak, total } = opts

  const streakStr = streak > 0
    ? `${streak}-win streak`
    : streak < 0
    ? `${Math.abs(streak)}-loss streak`
    : 'no current streak'

  const langInstruction = lang === 'pt-br'
    ? 'Responda APENAS em portugu\u00eas brasileiro. Use g\u00edrias de jogador de Dota brasileiro.'
    : 'Respond ONLY in English. Use gamer slang.'

  return `You are a sharp, witty Dota 2 commentator. ${langInstruction}

Write 2-3 sentences of punchy commentary about this player's last match. Be specific to the numbers. Can be funny, impressed, or mocking \u2014 match the mood to the stats. No headers, no labels, no markdown, just plain text.

Player: ${name}
Last match: ${hero}, ${kills}/${deaths}/${assists} (${kda.toFixed(1)} KDA), ${won ? 'WIN' : 'LOSS'}, ${gpm} GPM, ${heroDamage.toLocaleString()} hero damage
Recent ${total} games: ${winRate}% winrate, avg ${avgDeaths} deaths/game, avg ${avgKDA} KDA, favourite hero ${favHero}, ${streakStr}`
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
