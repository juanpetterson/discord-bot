import fs from 'fs'
import path from 'path'

const JOIN_SOUNDS_FILE = './src/assets/data/join-sounds.json'
const UPLOADS_DIR = './src/assets/uploads'
const PREFIX_SEPARATOR = ' - '

type JoinSoundMap = Record<string, string>

const LEGACY_JOIN_SOUNDS: JoinSoundMap = {
  carlesso2154: 'dw - tananana nananan.mp3',
  jacksonmajolo: 'geral - pode mamar.mp3',
  gbonassina: 'gre - ó o je me empurrando.ogg',
  'cristiano.bonassina': 'cris - boooa gurizada.mp3',
  eradim: 'rafiki - aiiiii gre.ogg',
  wellfb: 'sido - ja tem tornado ja de novo.ogg',
  dedableo: 'dw - um bilhao de dano.mp3',
  'juanpetterson.': 'binho - aiii rurrroor.ogg',
}

interface SoundMatch {
  fileName: string | null
  score: number
  suggestions: string[]
}

function ensureJoinSoundsFile() {
  const dir = path.dirname(JOIN_SOUNDS_FILE)
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }

  if (!fs.existsSync(JOIN_SOUNDS_FILE)) {
    fs.writeFileSync(JOIN_SOUNDS_FILE, JSON.stringify(LEGACY_JOIN_SOUNDS, null, 2))
  }
}

function normalizeSearchValue(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\.[^.]+$/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function levenshteinDistance(left: string, right: string) {
  if (!left.length) return right.length
  if (!right.length) return left.length

  const matrix = Array.from({ length: left.length + 1 }, () => Array(right.length + 1).fill(0))

  for (let i = 0; i <= left.length; i++) matrix[i][0] = i
  for (let j = 0; j <= right.length; j++) matrix[0][j] = j

  for (let i = 1; i <= left.length; i++) {
    for (let j = 1; j <= right.length; j++) {
      const cost = left[i - 1] === right[j - 1] ? 0 : 1
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      )
    }
  }

  return matrix[left.length][right.length]
}

function similarityScore(query: string, target: string) {
  if (!query || !target) return 0
  if (query === target) return 1
  if (target.startsWith(query)) return 0.98 - Math.min(0.2, (target.length - query.length) * 0.01)
  if (target.includes(query)) return 0.9 - Math.min(0.2, Math.max(0, target.length - query.length) * 0.01)

  const queryTokens = query.split(' ').filter(Boolean)
  if (queryTokens.length > 0 && queryTokens.every((token) => target.includes(token))) {
    return 0.82
  }

  const distance = levenshteinDistance(query, target)
  return 1 - distance / Math.max(query.length, target.length)
}

function listAvailableSounds() {
  if (!fs.existsSync(UPLOADS_DIR)) {
    return []
  }

  return fs.readdirSync(UPLOADS_DIR).filter((fileName) => {
    const filePath = path.join(UPLOADS_DIR, fileName)
    return fs.statSync(filePath).isFile()
  })
}

function getSoundAliases(fileName: string) {
  const baseName = fileName.replace(/\.[^.]+$/g, '')
  const label = baseName.includes(PREFIX_SEPARATOR)
    ? baseName.split(PREFIX_SEPARATOR).slice(1).join(PREFIX_SEPARATOR)
    : baseName

  return Array.from(new Set([baseName, label])).map(normalizeSearchValue).filter(Boolean)
}

function rankSounds(soundQuery: string) {
  const normalizedQuery = normalizeSearchValue(soundQuery)

  return listAvailableSounds()
    .map((fileName) => {
      const aliases = getSoundAliases(fileName)
      const score = Math.max(...aliases.map((alias) => similarityScore(normalizedQuery, alias)), 0)
      return { fileName, score }
    })
    .sort((left, right) => right.score - left.score)
}

function loadJoinSounds(): JoinSoundMap {
  ensureJoinSoundsFile()

  try {
    const parsed = JSON.parse(fs.readFileSync(JOIN_SOUNDS_FILE, 'utf-8')) as JoinSoundMap
    return { ...LEGACY_JOIN_SOUNDS, ...parsed }
  } catch {
    return { ...LEGACY_JOIN_SOUNDS }
  }
}

function saveJoinSounds(data: JoinSoundMap) {
  ensureJoinSoundsFile()
  fs.writeFileSync(JOIN_SOUNDS_FILE, JSON.stringify(data, null, 2))
}

export class JoinSoundHandler {
  static getSoundPath(fileName: string) {
    return path.join(UPLOADS_DIR, fileName)
  }

  static getJoinSoundForUser(userId: string, username?: string) {
    const joinSounds = loadJoinSounds()
    if (joinSounds[userId]) return joinSounds[userId]
    if (username && joinSounds[username]) return joinSounds[username]
    if (!username) return null

    const fallbackKey = Object.keys(joinSounds).find((key) => key.toLowerCase() === username.toLowerCase())
    return fallbackKey ? joinSounds[fallbackKey] : null
  }

  static setJoinSoundForUser(userId: string, soundFileName: string) {
    const joinSounds = loadJoinSounds()
    joinSounds[userId] = soundFileName
    saveJoinSounds(joinSounds)
  }

  static resolveClosestSound(soundQuery: string): SoundMatch {
    const ranked = rankSounds(soundQuery)
    const bestMatch = ranked[0]

    if (!bestMatch || bestMatch.score < 0.35) {
      return {
        fileName: null,
        score: 0,
        suggestions: ranked.slice(0, 5).map((entry) => entry.fileName),
      }
    }

    return {
      fileName: bestMatch.fileName,
      score: bestMatch.score,
      suggestions: ranked.slice(0, 5).map((entry) => entry.fileName),
    }
  }
}
