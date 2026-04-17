import fs from 'fs'
import https from 'https'

// ─── Steam ↔ Discord user map ─────────────────────────────────────────────
// Key: Discord user ID | Value: Steam32 account ID (not 64-bit)
export const DISCORD_TO_STEAM: Record<string, string> = {
  'carlesso2154': '137839730',
  'jacksonmajolo': '117092439',
  'gbonassina': '109723713',
  'cristiano.bonassina': '102605845',
  'eradim': '18354196',
  'dedableo': '1290315073',
  'juanpetterson.': '89756583',
  'arlovas': '65463725',
  'fermino': '89331213',
  'matheusagnes': '18344803',
  '.jogador.' : '96204401',
  'j14070' : '105610618',
  'xgrahl' : '51878986'
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
  console.log(`[DotaNick] Starting full nick refresh for ${Object.keys(DISCORD_TO_STEAM).length} players...`)
  const cache = loadDotaNicksCache()
  let successCount = 0
  let failCount = 0
  for (const [discordName, steamId] of Object.entries(DISCORD_TO_STEAM)) {
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
