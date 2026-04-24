import express from 'express'
import path from 'path'
import fs from 'fs'

import { client } from './index'
import { ClipHandler } from './handlers/ClipHandler'

const server = express()
server.use(express.json())

// Serve the web editor static files
server.use('/public', express.static(path.join(__dirname, 'public')))

server.all('/', (req, res) => {
  console.log('Bot is running: ' + new Date().toISOString())

  const currentTimeHours = new Date().getHours()
  const currentTimeMinutes = new Date().getMinutes()

  if (
    currentTimeHours === 11 &&
    currentTimeMinutes >= 0 &&
    currentTimeMinutes <= 5
  ) {
    const channel = client.channels.cache.get('1003668690052587623') as any

    if (!channel) return

    channel.send('🦧  <- jaque')
  }

  res.send('Bot is running')
})

// ========== Clip Editor API ==========

// Serve the editor page
server.get('/clips/:clipId/editor', (req, res) => {
  const clipId = req.params.clipId
  const meta = ClipHandler.getClipMetadata(clipId)

  if (!meta) {
    res.status(404).send('Clip not found or expired. Create a new clip with !clip.')
    return
  }

  const editorPath = path.join(__dirname, 'public', 'clip-editor.html')
  if (!fs.existsSync(editorPath)) {
    res.status(500).send('Editor page not found.')
    return
  }

  res.sendFile(editorPath)
})

// Get clip metadata (track list, durations)
server.get('/clips/:clipId/metadata', (req, res) => {
  const clipId = req.params.clipId
  const meta = ClipHandler.getClipMetadata(clipId)

  if (!meta) {
    res.status(404).json({ error: 'Clip not found or expired.' })
    return
  }

  const tracks = [
    { label: '🎵 Mixed Audio', fileName: meta.mixedFileName },
    ...meta.tracks.map(t => ({ label: `🎤 ${t.displayName}`, fileName: t.fileName })),
  ]

  res.json({
    clipId: meta.clipId,
    tracks,
    createdAt: meta.createdAt,
    expiresAt: meta.createdAt + 10 * 60 * 1000,
  })
})

// Stream audio file for playback
server.get('/clips/:clipId/audio/:trackFile', (req, res) => {
  const { clipId, trackFile } = req.params
  const audioPath = ClipHandler.getClipAudioPath(clipId, trackFile)

  if (!audioPath) {
    res.status(404).json({ error: 'Track not found or clip expired.' })
    return
  }

  const stat = fs.statSync(audioPath)
  res.setHeader('Content-Type', 'audio/mpeg')
  res.setHeader('Content-Length', stat.size)
  res.setHeader('Accept-Ranges', 'bytes')
  fs.createReadStream(audioPath).pipe(res)
})

// Trim audio and optionally post to Discord
server.post('/clips/:clipId/trim', async (req, res) => {
  const { clipId } = req.params
  const { trackFile, startMs, endMs, postToDiscord } = req.body

  if (!trackFile || typeof startMs !== 'number' || typeof endMs !== 'number') {
    res.status(400).json({ error: 'Missing required fields: trackFile, startMs, endMs' })
    return
  }

  if (endMs <= startMs || startMs < 0) {
    res.status(400).json({ error: 'Invalid time range.' })
    return
  }

  try {
    const trimmedPath = await ClipHandler.trimAndGetPath(clipId, trackFile, startMs, endMs)
    if (!trimmedPath) {
      res.status(404).json({ error: 'Clip not found, expired, or invalid track.' })
      return
    }

    if (postToDiscord) {
      const meta = ClipHandler.getClipMetadata(clipId)
      const trackLabel = trackFile === meta?.mixedFileName
        ? 'Mixed Audio'
        : meta?.tracks.find(t => t.fileName === trackFile)?.displayName || trackFile
      const startStr = formatMsToTime(startMs)
      const endStr = formatMsToTime(endMs)
      const posted = await ClipHandler.postTrimmedToChannel(clipId, trimmedPath, trackLabel, startStr, endStr)
      if (!posted) {
        res.status(500).json({ error: 'Failed to post to Discord channel.' })
        return
      }
      res.json({ success: true, message: 'Trimmed clip posted to Discord.' })
      return
    }

    // Return trimmed file as download
    const stat = fs.statSync(trimmedPath)
    res.setHeader('Content-Type', 'audio/mpeg')
    res.setHeader('Content-Length', stat.size)
    res.setHeader('Content-Disposition', `attachment; filename="${path.basename(trimmedPath)}"`)
    fs.createReadStream(trimmedPath).pipe(res)
  } catch (err) {
    console.error('Clip trim API error:', err)
    res.status(500).json({ error: 'Failed to trim audio.' })
  }
})

// Upload trimmed clip as a sound command
server.post('/clips/:clipId/upload', async (req, res) => {
  const { clipId } = req.params
  const { trackFile, startMs, endMs, author, soundName } = req.body

  if (!trackFile || typeof startMs !== 'number' || typeof endMs !== 'number') {
    res.status(400).json({ error: 'Missing required fields: trackFile, startMs, endMs' })
    return
  }

  if (!author || !soundName || typeof author !== 'string' || typeof soundName !== 'string') {
    res.status(400).json({ error: 'Missing required fields: author, soundName' })
    return
  }

  const safeAuthor = sanitizeFilenamePart(author)
  const safeName = sanitizeFilenamePart(soundName)

  if (!safeAuthor || !safeName) {
    res.status(400).json({ error: 'Author and Sound Name must contain at least one valid character.' })
    return
  }

  try {
    const trimmedPath = await ClipHandler.trimAndGetPath(clipId, trackFile, startMs, endMs)
    if (!trimmedPath) {
      res.status(404).json({ error: 'Clip not found, expired, or invalid track.' })
      return
    }

    const PREFIX_SEPARATOR = ' - '
    const destFileName = `${safeAuthor}${PREFIX_SEPARATOR}${safeName}.mp3`
    const destPath = path.join('./src/assets/uploads', destFileName)

    fs.copyFileSync(trimmedPath, destPath)
    res.json({ success: true, message: `Sound uploaded as ${destFileName}`, fileName: destFileName })
  } catch (err) {
    console.error('Clip upload API error:', err)
    res.status(500).json({ error: 'Failed to upload sound.' })
  }
})

function formatMsToTime(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

// Preserve Unicode letters (including accents), numbers, spaces, and safe punctuation.
// Strip only path-dangerous characters so the original name survives.
function sanitizeFilenamePart(input: string): string {
  return input
    .normalize('NFC')
    .replace(/[/\\:*?"<>|\x00-\x1f]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/^\.+|\.+$/g, '')
    .trim()
}

export const keepAlive = () => {
  server.listen(8080, () => {
    console.log('Server is ready!')
  })
}
