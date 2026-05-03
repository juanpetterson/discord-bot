import * as fs from 'fs'
import * as path from 'path'

const STORE_DIR = path.resolve(process.cwd(), 'data')
const STORE_FILE = path.join(STORE_DIR, 'recent-heroes.json')
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000 // 30 days

type Entry = { heroIds: number[]; updatedAt: number }
type Store = Record<string, Entry>

function load(): Store {
  try {
    if (!fs.existsSync(STORE_FILE)) return {}
    const raw = fs.readFileSync(STORE_FILE, 'utf8')
    const parsed = JSON.parse(raw) as Store
    const now = Date.now()
    let mutated = false
    for (const [channelId, entry] of Object.entries(parsed)) {
      if (!entry || typeof entry.updatedAt !== 'number' || now - entry.updatedAt > MAX_AGE_MS) {
        delete parsed[channelId]
        mutated = true
      }
    }
    if (mutated) save(parsed)
    return parsed
  } catch (err) {
    console.warn('[recentHeroes] failed to load store:', (err as Error).message)
    return {}
  }
}

function save(store: Store): void {
  try {
    if (!fs.existsSync(STORE_DIR)) fs.mkdirSync(STORE_DIR, { recursive: true })
    fs.writeFileSync(STORE_FILE, JSON.stringify(store, null, 2), 'utf8')
  } catch (err) {
    console.warn('[recentHeroes] failed to save store:', (err as Error).message)
  }
}

export function getRecentHeroIds(channelId: string): number[] {
  const entry = load()[channelId]
  return entry?.heroIds ?? []
}

export function recordDraft(channelId: string, heroIds: number[]): void {
  if (!channelId || heroIds.length === 0) return
  const store = load()
  store[channelId] = { heroIds: [...new Set(heroIds)], updatedAt: Date.now() }
  save(store)
}

export function clearRecentHeroes(channelId: string): void {
  const store = load()
  if (store[channelId]) {
    delete store[channelId]
    save(store)
  }
}
