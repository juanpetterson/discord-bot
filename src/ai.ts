import { GoogleGenerativeAI } from '@google/generative-ai'

// ─── Gemini setup ──────────────────────────────────────────────────────────
// Set GEMINI_API_KEY in your .env — get a free key at https://ai.google.dev
//
// Model used: gemini-2.0-flash (free tier: 1,500 req/day, 15 RPM)

const API_KEY = process.env.GEMINI_API_KEY ?? ''
const MODEL_NAME = 'gemini-2.0-flash'

let _client: ReturnType<typeof GoogleGenerativeAI.prototype.getGenerativeModel> | null = null

function getModel() {
  if (!API_KEY) return null
  if (!_client) {
    const genAI = new GoogleGenerativeAI(API_KEY)
    _client = genAI.getGenerativeModel({ model: MODEL_NAME })
  }
  return _client
}

/**
 * Ask Gemini to generate text for the given prompt.
 * Returns null if GEMINI_API_KEY is not set or if the request fails,
 * so callers can fall back to hardcoded responses.
 */
export async function askGemini(prompt: string): Promise<string | null> {
  const model = getModel()
  if (!model) {
    console.warn('[AI] GEMINI_API_KEY not set — using fallback commentary.')
    return null
  }
  try {
    const result = await model.generateContent(prompt)
    const text = result.response.text().trim()
    return text || null
  } catch (err: any) {
    console.error('[AI] Gemini request failed:', err?.message ?? err)
    return null
  }
}

// ─── Prompt builders ───────────────────────────────────────────────────────

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
    ? 'Responda APENAS em português brasileiro. Use gírias de jogador de Dota brasileiro.'
    : 'Respond ONLY in English. Use gamer slang.'

  return `You are a sharp, witty Dota 2 commentator. ${langInstruction}

Write 2-3 sentences of punchy commentary about this player's last match. Be specific to the numbers. Can be funny, impressed, or mocking — match the mood to the stats. No headers, no labels, no markdown, just plain text.

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
    ? 'Responda APENAS em português brasileiro. Use gírias e humor típico de jogadores brasileiros de Dota.'
    : 'Respond ONLY in English. Use gamer slang and dark humour.'

  return `You are a savage but genuinely funny Dota 2 roast comedian. ${langInstruction}

Write 3-5 short roast lines about this player using their REAL stats as ammunition. Each line should be a standalone jab — specific, creative, and punchy. No headers, no labels, no markdown, no bullet points, just plain text lines.

Player: ${name}
Stats (last ${total} games): ${wins}W/${total - wins}L (${winRate}% winrate), avg ${avgDeaths} deaths/game, avg ${avgKDA} KDA, favourite hero: ${favHero}, current streak: ${streakStr}, worst single game: ${worstDeaths} deaths, games with 10+ deaths: ${feedGames}`
}
