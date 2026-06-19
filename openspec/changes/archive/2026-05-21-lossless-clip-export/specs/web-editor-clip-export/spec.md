## ADDED Requirements

### Requirement: Exported clip preserves source encoding

When the user downloads or uploads a trimmed clip from the web editor, the resulting file SHALL contain the original audio source's encoded bytes within the selected time window. The system MUST NOT re-decode and re-encode the audio: codec, bitrate, sample rate, and channel count of the output MUST match the source file exactly.

#### Scenario: Download preserves MP3 bitrate and sample rate

- **WHEN** the user loads an MP3 clip in the editor and clicks **Download** with a selected region
- **THEN** the downloaded file is an MP3 whose bitrate, sample rate, and channel count (as reported by `ffprobe`) are identical to the source MP3
- **AND** the file extension is `.mp3`

#### Scenario: Upload-to-bot preserves source format

- **WHEN** the user clicks **Upload to bot** with a selected region from an MP3 source
- **THEN** the file the bot saves under `src/assets/uploads/` is an MP3
- **AND** the saved file's encoding parameters match the source MP3

#### Scenario: Non-MP3 source formats preserved

- **WHEN** the source attachment is `.ogg` or `.m4a`
- **THEN** the downloaded and uploaded clips use the same extension and codec as the source

### Requirement: Original source bytes are retained for export

The editor SHALL fetch and retain the original audio attachment's bytes (independent of WaveSurfer's decoded buffer) so that export operations can trim the source directly. WaveSurfer's decoded `AudioBuffer` MUST NOT be the source of bytes for download or upload.

#### Scenario: Source bytes available after load

- **WHEN** a track finishes loading in the editor
- **THEN** the original source bytes and MIME type are available for the export handlers
- **AND** the export handlers do not call `wavesurfer.getDecodedData()` to produce the output file

### Requirement: Lossless trim via ffmpeg stream-copy

The editor SHALL trim the selected region using an ffmpeg stream-copy operation (`-ss <start> -to <end> -c copy`) executed in the browser via `ffmpeg.wasm`. The trim MUST NOT decode and re-encode the audio.

#### Scenario: Trim produces stream-copied output

- **WHEN** the user triggers Download or Upload
- **THEN** the system runs an ffmpeg.wasm command using `-c copy` against the original source bytes
- **AND** the output bytes contain only the selected region's encoded frames

#### Scenario: Frame-boundary trim is acceptable

- **WHEN** the selected region's start or end does not align with an MP3 frame boundary
- **THEN** the trim snaps to the nearest frame boundary (up to ~26 ms granularity for MP3)
- **AND** this behavior is considered correct (no requirement for sample-accurate trimming)

### Requirement: ffmpeg.wasm is lazy-loaded

The `ffmpeg.wasm` runtime SHALL be loaded only on first export click, not during initial page render.

#### Scenario: Page render not delayed

- **WHEN** the editor page loads
- **THEN** no `ffmpeg.wasm` resources are fetched
- **AND** the waveform renders as soon as the proxied audio is decoded

#### Scenario: First export shows loading status

- **WHEN** the user clicks Download or Upload for the first time in the session
- **THEN** the editor displays a visible status message while `ffmpeg.wasm` loads
- **AND** subsequent export clicks reuse the loaded runtime without re-downloading

### Requirement: Cross-origin isolation headers

The editor's Vercel configuration SHALL serve editor pages with `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp` headers so that `ffmpeg.wasm`'s `SharedArrayBuffer` usage works.

#### Scenario: Headers present on editor HTML response

- **WHEN** a browser requests the editor's `index.html`
- **THEN** the response includes `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp`

#### Scenario: Same-origin API calls still work

- **WHEN** the editor calls `/api/proxy`, `/api/message`, or `/api/upload` after the headers are set
- **THEN** the requests succeed without CORS or COEP errors

### Requirement: Upload endpoint accepts source format metadata

The `/api/upload` endpoint SHALL accept `mime` and `ext` fields in the request body and use them when constructing the attachment filename and MIME type sent to Discord. The `ext` field MUST be validated against an allowlist of `mp3`, `wav`, `ogg`, `m4a`.

#### Scenario: Valid extension used in filename

- **WHEN** the editor posts an upload with `ext: "mp3"`, `mime: "audio/mpeg"`
- **THEN** the file attached to the Discord message is named `<author> - <name>.mp3`
- **AND** its MIME type is `audio/mpeg`

#### Scenario: Invalid extension rejected

- **WHEN** the editor posts an upload with `ext: "exe"`
- **THEN** the endpoint responds with HTTP 400 and an error message
- **AND** no Discord message is sent

#### Scenario: Missing extension falls back to mp3

- **WHEN** the request body omits `ext` and `mime`
- **THEN** the endpoint defaults to `ext: "mp3"` and `mime: "audio/mpeg"` for backward compatibility

### Requirement: Export failures surface a visible error

When the lossless trim cannot be performed (e.g., `ffmpeg.wasm` fails to load, the source bytes are missing, or the ffmpeg command exits non-zero), the editor SHALL surface a visible error message to the user and MUST NOT silently fall back to a lossy export path.

#### Scenario: ffmpeg load failure

- **WHEN** `ffmpeg.wasm` fails to load (e.g., network error, COEP misconfigured)
- **THEN** the editor shows a clear error status to the user
- **AND** no file is downloaded or uploaded

#### Scenario: ffmpeg command failure

- **WHEN** the ffmpeg trim command exits non-zero
- **THEN** the editor shows an error including a brief reason
- **AND** the user can retry without reloading the page
