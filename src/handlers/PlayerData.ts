import fs from 'fs'
import https from 'https'
import { loadDataFile } from '../config'

// ─── Steam ↔ Discord user map ─────────────────────────────────────────────
// Loaded from src/assets/data/players.json (gitignored). See players.example.json.
// Each Discord username maps to ONE Steam32 account ID OR a LIST of them
// (for players with multiple Steam accounts):
//   "someuser": "137839730"
//   "altuser":  ["18354196", "987654321"]
const RAW_PLAYERS = loadDataFile<Record<string, string | string[]>>('players.json', {})

/** Discord username → list of Steam32 account IDs (always ≥1 once present). */
export const PLAYER_ACCOUNTS: Record<string, string[]> = Object.fromEntries(
  Object.entries(RAW_PLAYERS)
    .filter(([key]) => !key.startsWith('_'))
    .map(([name, value]) => [name, (Array.isArray(value) ? value : [value]).filter(Boolean)])
    .filter(([, ids]) => ids.length > 0)
)

/**
 * Backward-compatible map of Discord username → PRIMARY (first) Steam32 ID.
 * Use this for display/nick lookups. For features that must cover every
 * account, prefer allSteamAccounts() or getSteamIdsFor().
 */
export const DISCORD_TO_STEAM: Record<string, string> = Object.fromEntries(
  Object.entries(PLAYER_ACCOUNTS).map(([name, ids]) => [name, ids[0]])
)

const STEAM64_BASE = BigInt('76561197960265728')

/** Normalizes a Steam64 ID to a Steam32 account ID (leaves Steam32 untouched). */
export function toAccountId(steamId: string): string {
  return steamId.length >= 17 ? (BigInt(steamId) - STEAM64_BASE).toString() : steamId
}

/** Flat list of every (discordName, steamId) pair — one entry per account. */
export function allSteamAccounts(): Array<{ discordName: string; steamId: string }> {
  const out: Array<{ discordName: string; steamId: string }> = []
  for (const [discordName, ids] of Object.entries(PLAYER_ACCOUNTS)) {
    for (const steamId of ids) out.push({ discordName, steamId })
  }
  return out
}

/** All Steam32 IDs for a Discord username (case-insensitive). Empty if unknown. */
export function getSteamIdsFor(discordName: string): string[] {
  if (PLAYER_ACCOUNTS[discordName]) return PLAYER_ACCOUNTS[discordName]
  const key = Object.keys(PLAYER_ACCOUNTS).find(k => k.toLowerCase() === discordName.toLowerCase())
  return key ? PLAYER_ACCOUNTS[key] : []
}

// ─── Dota 2 nick cache ───────────────────────────────────────────────────

const DOTA_NICKS_FILE = './src/assets/data/dota-nicks.json'
const DOTA_NICK_TTL_MS = 6 * 60 * 60 * 1000 // 6 hours

interface DotaNickEntry {
  nick: string
  fetchedAt: number // unix ms
}

function loadDotaNicksCache(): Record<string, DotaNickEntry> {
  try {
    if (!fs.existsSync(DOTA_NICKS_FILE)) return {}
    return JSON.parse(fs.readFileSync(DOTA_NICKS_FILE, 'utf-8'))
  } catch {
    return {}
  }
}

function saveDotaNicksCache(cache: Record<string, DotaNickEntry>) {
  fs.writeFileSync(DOTA_NICKS_FILE, JSON.stringify(cache, null, 2))
}

function fetchPlayerProfile(steamId: string): Promise<any> {
  return new Promise((resolve) => {
    const url = `https://api.opendota.com/api/players/${steamId}`
    https
      .get(url, (res) => {
        let body = ''
        res.on('data', (chunk) => (body += chunk))
        res.on('end', () => {
          if (res.statusCode !== 200) {
            console.warn(`[DotaNick] API returned status ${res.statusCode} for steamId ${steamId}: ${body.slice(0, 200)}`)
            resolve(null)
            return
          }
          try { resolve(JSON.parse(body)) } catch (e) {
            console.warn(`[DotaNick] Failed to parse API response for steamId ${steamId}: ${body.slice(0, 200)}`)
            resolve(null)
          }
        })
      })
      .on('error', (err) => {
        console.warn(`[DotaNick] HTTP error fetching profile for steamId ${steamId}:`, err.message)
        resolve(null)
      })
  })
}

/** Returns the Dota 2 persona name for a steam32 account id, using a 6h cache. */
export async function fetchDotaNick(steamId: string | undefined, fallback: string): Promise<string> {
  if (!steamId) return fallback

  const cache = loadDotaNicksCache()
  const entry = cache[steamId]

  if (entry && Date.now() - entry.fetchedAt < DOTA_NICK_TTL_MS) {
    return entry.nick
  }

  try {
    const profile = await fetchPlayerProfile(steamId)
    const nick: string = profile?.profile?.personaname || fallback
    cache[steamId] = { nick, fetchedAt: Date.now() }
    saveDotaNicksCache(cache)
    console.log(`[DotaNick] Fetched nick for steamId ${steamId}: ${nick}`)
    return nick
  } catch (err) {
    console.warn(`[DotaNick] Failed to fetch nick for steamId ${steamId}:`, err)
    return entry?.nick ?? fallback
  }
}

/**
 * Force-refreshes the Dota 2 nickname for every player in DISCORD_TO_STEAM,
 * bypassing the TTL cache. Called daily by PollingJob.
 */
export async function refreshAllDotaNicks(): Promise<void> {
  const accounts = allSteamAccounts()
  console.log(`[DotaNick] Starting full nick refresh for ${accounts.length} accounts...`)
  const cache = loadDotaNicksCache()
  let successCount = 0
  let failCount = 0
  for (const { discordName, steamId } of accounts) {
    try {
      const profile = await fetchPlayerProfile(steamId)
      if (!profile) {
        console.warn(`[DotaNick] No profile returned for ${discordName} (${steamId}) — keeping old nick: ${cache[steamId]?.nick ?? '(none)'}`) 
        failCount++
        continue
      }
      const nick: string = profile?.profile?.personaname || discordName
      const oldNick = cache[steamId]?.nick
      cache[steamId] = { nick, fetchedAt: Date.now() }
      if (oldNick && oldNick !== nick) {
        console.log(`[DotaNick] Nick CHANGED for ${discordName} (${steamId}): "${oldNick}" → "${nick}"`)
      } else {
        console.log(`[DotaNick] Refreshed nick for ${discordName} (${steamId}): ${nick}`)
      }
      successCount++
    } catch (err) {
      console.warn(`[DotaNick] Failed to refresh nick for ${discordName} (${steamId}):`, err)
      failCount++
    }
  }
  saveDotaNicksCache(cache)
  console.log(`[DotaNick] Full refresh complete — ${successCount} success, ${failCount} failed`)
}
