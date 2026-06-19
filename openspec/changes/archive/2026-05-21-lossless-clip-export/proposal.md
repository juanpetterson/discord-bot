## Why

The web editor's `!clip` page plays audio at full quality (WaveSurfer v7 streams via the native `<audio>` element), but the **Download** and **Upload to bot** buttons produce noticeably worse audio. They re-encode through a lossy chain: `MP3 → AudioContext.decodeAudioData` (resamples to the context's sample rate, typically 48 kHz) `→ Float32 → 16-bit PCM WAV`. The exported clip should match playback quality.

## What Changes

- Replace the WAV export pipeline used by both **Download** and **Upload** in `editor/public/index.html` with a lossless trim of the original audio bytes using `ffmpeg.wasm` (`-ss start -to end -c copy`).
- Fetch the original audio bytes alongside WaveSurfer's load so the export operates on the source file (not the decoded buffer).
- Lazy-load `ffmpeg.wasm` from a CDN on first export click so initial page render is unaffected.
- Add `Cross-Origin-Opener-Policy` and `Cross-Origin-Embedder-Policy` headers in `editor/vercel.json` (required for `ffmpeg.wasm`'s SharedArrayBuffer use).
- Output preserves the source format and extension (MP3 in → MP3 out, OGG in → OGG out, etc.).
- **BREAKING** (editor-internal): `editor/api/upload.ts` now accepts and uses `mime` + `ext` fields from the request body; the resulting attachment filename uses the source extension instead of hardcoded `.wav`. The bot-side handler in `src/index.ts` already preserves whatever extension arrives, so no bot change is required.

## Capabilities

### New Capabilities
- `web-editor-clip-export`: How the web editor produces a trimmed audio clip for download and upload — covering source-byte retention, the ffmpeg.wasm trim pipeline, output format preservation, and required cross-origin isolation headers.

### Modified Capabilities
<!-- None — no existing specs in openspec/specs/ -->

## Impact

- **Code**: `editor/public/index.html` (export paths), `editor/api/upload.ts` (filename/MIME), `editor/vercel.json` (COOP/COEP headers).
- **Dependencies**: `@ffmpeg/ffmpeg` and `@ffmpeg/util` loaded from CDN at runtime (no `package.json` change).
- **Bundle/runtime**: ~25 MB ffmpeg-core wasm fetched lazily on first export; cached by browser thereafter.
- **Cross-origin**: New COOP/COEP headers on editor pages — verify the editor still loads correctly in normal browser tabs and that same-origin `/api/*` calls (proxy, upload, message) continue to work.
- **No bot changes**: `downloadMP3` in `src/index.ts:944` already preserves the source extension when saving uploaded sounds.
