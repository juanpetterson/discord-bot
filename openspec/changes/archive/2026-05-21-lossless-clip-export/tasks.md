## 1. Setup

- [x] 1.1 Pin a specific `@ffmpeg/ffmpeg` and `@ffmpeg/util` version (latest stable multi-threaded build) and note the CDN URLs in a code comment
- [x] 1.2 Add `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp` response headers for editor pages in `editor/vercel.json`
- [ ] 1.3 Deploy headers-only change to a preview env and confirm the editor still loads and `/api/proxy`, `/api/message`, `/api/upload` still succeed

## 2. Capture source bytes at load time

- [x] 2.1 In `editor/public/index.html`, add module-level `currentSourceBytes`, `currentSourceMime`, `currentSourceExt`
- [x] 2.2 In `loadTrack()`, fetch the proxy URL in parallel with WaveSurfer's load, store the `ArrayBuffer`, read `Content-Type`, derive extension from the track filename, populate the three variables on success
- [x] 2.3 Reset the three variables and disable Download/Upload buttons whenever a new track starts loading
- [x] 2.4 Surface a visible error if the source-byte fetch fails

## 3. ffmpeg.wasm integration

- [x] 3.1 Add `<script>` tags for `@ffmpeg/ffmpeg` and `@ffmpeg/util` from the pinned CDN URLs
- [x] 3.2 Implement a singleton `async function getFfmpeg()` that lazily instantiates `FFmpeg` and calls `.load()` once, returning the same instance on subsequent calls
- [x] 3.3 Show a "Loading audio engine…" status while `getFfmpeg()` resolves for the first time
- [x] 3.4 Implement `async function buildTrimmedClip(start, end)`:
  - writes `currentSourceBytes` to ffmpeg's virtual FS as `input.<ext>`
  - runs `ffmpeg -ss <start> -to <end> -i input.<ext> -c copy output.<ext>`
  - reads `output.<ext>` back as a `Uint8Array`
  - returns `{ bytes, mime: currentSourceMime, ext: currentSourceExt }`
  - throws a descriptive error if any step fails

## 4. Rewire Download handler

- [x] 4.1 In the Download click handler in `editor/public/index.html`, remove the WAV-build block (`getDecodedData()` + PCM/WAV assembly)
- [x] 4.2 Replace with a call to `buildTrimmedClip(activeRegion.start, activeRegion.end)` (show a "Trimming…" status while it runs)
- [x] 4.3 Create the download blob with the returned `bytes` and `mime`, filename `trimmed_<sourceBaseName>.<ext>`
- [x] 4.4 Surface a visible error if the trim throws; do not fall back to the WAV path

## 5. Rewire Upload handler

- [x] 5.1 In the Upload confirm handler, remove the duplicated WAV-build block
- [x] 5.2 Replace with a call to `buildTrimmedClip(activeRegion.start, activeRegion.end)`
- [x] 5.3 Base64-encode the returned `bytes` and include `mime` + `ext` in the POST body to `/api/upload`
- [x] 5.4 Surface a visible error if the trim throws

## 6. Update upload API

- [x] 6.1 In `editor/api/upload.ts`, accept optional `mime` and `ext` fields from the request body
- [x] 6.2 Validate `ext` against an allowlist of `mp3`, `wav`, `ogg`, `m4a`; reject with HTTP 400 otherwise
- [x] 6.3 Default `ext` to `mp3` and `mime` to `audio/mpeg` when omitted (backward compatibility)
- [x] 6.4 Replace the hardcoded `.wav` filename and `audio/wav` MIME with the validated `ext`/`mime`
- [x] 6.5 Confirm the bot's `downloadMP3` handler still saves the file correctly with the new extension (no code change expected)

## 7. Manual verification

- [ ] 7.1 Quality A/B: download a trimmed clip, compare to the source MP3 played in the editor — spectrograms identical within the trim window
- [ ] 7.2 `ffprobe` the trimmed file and the source — confirm bitrate, sample rate, and channel count match
- [ ] 7.3 Upload-to-bot: confirm the bot posts `✅ Sound Uploaded` with a `.mp3` filename and the saved file plays at full quality
- [ ] 7.4 Repeat 7.1–7.3 with a non-MP3 source (`.ogg` or `.m4a` if available)
- [ ] 7.5 Regression: waveform, region drag/resize, Preview, Stop all still work
- [ ] 7.6 Failure mode: simulate a CDN block on `unpkg.com` (DevTools network block) and confirm a clear error is shown — no silent lossy fallback
- [ ] 7.7 Header check: editor loads correctly in a normal browser tab; same-origin API calls still succeed
