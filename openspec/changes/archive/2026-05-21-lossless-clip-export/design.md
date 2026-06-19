## Context

The web editor (`editor/public/index.html`) lets users trim audio clips produced by the bot's `!clip` command and either download them or upload them back to the bot. It uses WaveSurfer.js v7 for waveform rendering and playback.

In WaveSurfer v7's default configuration, **playback** streams from a native `<audio>` element (the browser decodes the source MP3 in real time with full fidelity), while the waveform is rendered from a separate decoded `AudioBuffer` obtained via `AudioContext.decodeAudioData`. The current export code at `editor/public/index.html:436-479` (Download) and `:535-574` (Upload) calls `wavesurfer.getDecodedData()` to retrieve that `AudioBuffer`, slices the selected region, converts to 16-bit PCM, and wraps it in a WAV container.

This export pipeline is lossy for two reasons:
1. `decodeAudioData` resamples to the `AudioContext`'s sample rate (Chrome default 48 kHz). When the source MP3 has a different rate (e.g., 44.1 kHz), the buffer is interpolated.
2. The Float32 PCM samples are then quantized to 16-bit integers — a second irreversible step.

Both steps are invisible to playback (which never touches `getDecodedData()` output), so the user hears full quality during preview but a degraded clip on download/upload.

The source bytes are already available from the existing `/api/proxy` endpoint that streams the Discord CDN attachment unchanged. The cleanest fix is to trim those bytes losslessly with `ffmpeg.wasm` (stream-copy, no re-encode).

## Goals / Non-Goals

**Goals:**
- Exported clip (download or upload) is **bit-identical in encoding** to the source within the trim window — same codec, bitrate, sample rate, channel count, encoder padding.
- Initial page render is not delayed by ffmpeg.wasm — fetched lazily on first export click.
- Source formats other than MP3 (e.g., `.ogg`, `.m4a` from Discord voice messages) are handled transparently.
- Bot-side handler in `src/index.ts` continues to work unchanged.

**Non-Goals:**
- Frame-perfect sample-accurate trimming. Stream-copy on MP3 trims on frame boundaries (~26 ms granularity). This is acceptable for the soundboard use case.
- Re-encoding to a different output format (e.g., normalizing everything to WAV). Output format follows input.
- Server-side trimming. Vercel serverless lacks a system ffmpeg binary; bundling an ffmpeg layer adds infra complexity. Doing it in the browser keeps the backend trivial.
- Removing the existing WAV-build code path with a fallback. If ffmpeg.wasm fails to load, surface an error rather than silently re-introducing lossy export.

## Decisions

### D1: Lossless MP3 trim via ffmpeg.wasm (browser-side)

**Chosen**: Load `@ffmpeg/ffmpeg` + `@ffmpeg/util` from a public CDN; on first export click, instantiate a singleton `FFmpeg` and call `.load()`. Run `ffmpeg -ss <start> -to <end> -i input.<ext> -c copy output.<ext>` to trim without re-encoding.

**Alternatives considered**:
- **Decode fresh in an `OfflineAudioContext` at the source's sample rate, then export WAV.** Avoids the AudioContext-default resample, but Float32→Int16 quantization remains and output is no longer the original codec. Larger files for MP3 sources.
- **Server-side trim via a new `/api/trim` Vercel endpoint.** Vercel functions don't ship ffmpeg; we'd need ffmpeg-static (large cold-start), a Lambda layer, or a separate worker. Heavier infra change for the same result.
- **`MediaRecorder` capturing playback.** Re-encodes through whatever codec MediaRecorder supports, with no quality guarantees. Real-time only (slow).

**Rationale**: Browser-side stream-copy is the only option that mathematically preserves source quality with no backend changes.

### D2: Output format follows input

**Chosen**: Detect source extension/MIME from the proxy response and write the trimmed output with the same extension. Send `mime` + `ext` in the upload payload so the server attaches the file with the correct extension.

**Alternatives considered**:
- **Always output MP3.** Would require re-encoding non-MP3 sources, defeating the lossless goal.
- **Always output WAV.** Same problem; also bloats file size.

**Rationale**: Stream-copy only works when the container/codec is preserved. The bot's `downloadMP3` in `src/index.ts:944` already uses the incoming filename's extension, so this is transparent server-side.

### D3: CDN-loaded ffmpeg.wasm, no `package.json` change

**Chosen**: `<script>` tag pointing to `unpkg.com/@ffmpeg/ffmpeg@<pinned-version>/dist/umd/ffmpeg.js` (and matching `@ffmpeg/util`). Initialize lazily on first export.

**Alternatives considered**:
- **npm-install and bundle.** The editor is currently a single static `index.html` with no build step; introducing one for a single dependency is disproportionate.
- **Self-host the wasm.** Adds ~25 MB of static assets to the Vercel deploy. CDN is fine and is cache-friendly.

**Rationale**: Preserves the editor's "zero-build static page" simplicity.

### D4: COOP/COEP headers on editor pages

**Chosen**: Add `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp` to `editor/vercel.json`. Required for `ffmpeg.wasm` to use `SharedArrayBuffer`.

**Alternatives considered**:
- **Single-threaded ffmpeg.wasm.** Slower; future ffmpeg.wasm releases may drop single-threaded builds. The trim is fast enough that this would still work, but multi-threaded is preferred.

**Rationale**: Standard requirement for wasm threading; same-origin proxy and API calls are unaffected.

## Risks / Trade-offs

- **First export latency**: First click downloads ~25 MB of wasm/JS. → Mitigated by lazy-loading with a clear "Loading audio engine…" status, browser-cached for subsequent uses, and a one-time cost per browser/session.
- **COOP/COEP headers break embedding**: If the editor is ever loaded inside an iframe from a cross-origin parent, COEP may block it. → The editor is a top-level page opened from Discord links; no known iframe-embed use case. Verify during testing.
- **Stream-copy trim boundary inaccuracy**: MP3 stream-copy snaps to frame boundaries (~26 ms). → Acceptable for soundboard clips; users won't notice. Document in the spec.
- **ffmpeg.wasm CDN outage**: Trim becomes unusable. → Pin a specific version. Could later self-host if outages occur.
- **Unsupported source formats**: If Discord ever serves a container ffmpeg's wasm build can't stream-copy, trim fails. → Allowlist `mp3`, `wav`, `ogg`, `m4a` server-side; surface a clear error if ffmpeg returns non-zero.
- **No fallback to lossy WAV**: We deliberately do not silently revert to the old path on ffmpeg failure. → Failure is loud (visible error message) so the user knows to retry rather than getting a quietly degraded file.

## Migration Plan

No data migration needed. Deployment:
1. Ship `editor/vercel.json` header change first (safe; doesn't break existing behavior).
2. Verify editor still loads in a normal browser tab.
3. Ship the `index.html` + `upload.ts` changes together.
4. Rollback: revert the editor commits; bot-side is untouched throughout.

## Open Questions

None blocking. Version of `@ffmpeg/ffmpeg` to pin will be the latest stable at implementation time (verify the multi-threaded build is published).
