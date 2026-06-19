import fs from 'fs'
import path from 'path'

// ─── Centralized runtime configuration ─────────────────────────────────────
// Anything that is specific to a particular Discord server / community lives
// here so the source code can be shared publicly without leaking data.
//
// Values come from environment variables (see .env.example). Per-user data
// (Steam mappings, join sounds) lives in gitignored JSON files under
// src/assets/data — copy the *.example.json files to get started.

/**
 * Discord channel where the bot posts notifications: new-match alerts,
 * daily/scheduled messages, and any `custom-message` events.
 */
export const NOTIFY_CHANNEL_ID = process.env.NOTIFY_CHANNEL_ID ?? ''

/**
 * Optional scheduled message posted to NOTIFY_CHANNEL_ID once per day.
 * Leave DAILY_MESSAGE empty to disable the scheduled message entirely.
 */
export const DAILY_MESSAGE = process.env.DAILY_MESSAGE ?? ''
export const DAILY_MESSAGE_HOUR = Number(process.env.DAILY_MESSAGE_HOUR ?? '11')

/**
 * Reads a JSON data file from src/assets/data, falling back to its committed
 * `*.example.json` template when the real (gitignored) file is absent. This
 * lets a freshly-cloned repo boot with placeholder data instead of crashing.
 */
export function loadDataFile<T>(fileName: string, fallback: T): T {
  const dir = './src/assets/data'
  const realPath = path.join(dir, fileName)
  const examplePath = path.join(dir, fileName.replace(/\.json$/, '.example.json'))

  for (const candidate of [realPath, examplePath]) {
    try {
      if (fs.existsSync(candidate)) {
        return JSON.parse(fs.readFileSync(candidate, 'utf-8')) as T
      }
    } catch (err) {
      console.warn(`[config] Failed to parse ${candidate}:`, err)
    }
  }

  return fallback
}
