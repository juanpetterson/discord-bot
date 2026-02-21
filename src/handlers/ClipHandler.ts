import {
  type VoiceConnection,
  EndBehaviorType,
} from '@discordjs/voice';
import type { Message, Guild } from 'discord.js';
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import archiver from 'archiver';
import { t } from '../i18n';

const CLIP_DURATION_MS = 60_000; // 1 minute rolling buffer
const SAMPLE_RATE = 48000;
const CHANNELS = 2;
const BYTES_PER_SAMPLE = 2; // 16-bit signed LE
const FRAME_SIZE = 960; // samples per Opus frame (20ms at 48kHz)
const FRAME_DURATION_MS = 20; // each Opus frame = 20ms
const BYTES_PER_FRAME = FRAME_SIZE * CHANNELS * BYTES_PER_SAMPLE; // 3840 bytes per 20ms frame
const PRUNE_INTERVAL_MS = 10_000;
const SILENCE_TIMEOUT_MS = 2000; // re-subscribe after 2s silence
const CLIP_COOLDOWN_MS = 30_000; // 30-second cooldown between clips
const CLIPS_PATH = './src/assets/clips';

/**
 * A speaking session represents a contiguous block of audio from one user.
 * PCM chunks within a session are sequential — no gaps, no timestamp alignment needed.
 */
interface SpeakingSession {
  startTimestamp: number;  // when this session started (Date.now())
  pcmChunks: Buffer[];     // ordered PCM chunks (each ~3840 bytes = 20ms)
  totalBytes: number;      // sum of all chunk lengths
}

interface UserAudioBuffer {
  userId: string;
  displayName: string;
  sessions: SpeakingSession[];
}

export class ClipHandler {
  private static userBuffers: Map<string, UserAudioBuffer> = new Map();
  private static activeSubscriptions: Map<string, SpeakingSession> = new Map(); // userId -> current session
  private static isRecording = false;
  private static connection: VoiceConnection | null = null;
  private static guild: Guild | null = null;
  private static pruneInterval: NodeJS.Timeout | null = null;
  private static speakingHandler: ((userId: string) => void) | null = null;
  private static lastClipTimestamp = 0;

  /**
   * Start recording audio from all users in the voice channel.
   * Call this when the bot's voice connection becomes Ready.
   */
  static startRecording(connection: VoiceConnection, guild: Guild) {
    if (ClipHandler.isRecording && ClipHandler.connection === connection) return;

    if (ClipHandler.isRecording) {
      ClipHandler.stopRecording();
    }

    ClipHandler.connection = connection;
    ClipHandler.guild = guild;
    ClipHandler.isRecording = true;

    const receiver = connection.receiver;

    ClipHandler.speakingHandler = (userId: string) => {
      if (!ClipHandler.isRecording) return;
      if (ClipHandler.activeSubscriptions.has(userId)) return;
      ClipHandler.subscribeToUser(userId, receiver);
    };

    receiver.speaking.on('start', ClipHandler.speakingHandler);

    ClipHandler.pruneInterval = setInterval(() => {
      ClipHandler.pruneOldData();
    }, PRUNE_INTERVAL_MS);

    console.log('ClipHandler: Started recording voice channel audio.');
  }

  /**
   * Stop recording and clear all buffers.
   */
  static stopRecording() {
    ClipHandler.isRecording = false;

    if (ClipHandler.speakingHandler && ClipHandler.connection) {
      try {
        (ClipHandler.connection.receiver.speaking as any).removeListener('start', ClipHandler.speakingHandler);
      } catch (e) {
        // Ignore
      }
    }

    ClipHandler.speakingHandler = null;
    ClipHandler.activeSubscriptions.clear();
    ClipHandler.userBuffers.clear();
    ClipHandler.connection = null;
    ClipHandler.guild = null;

    if (ClipHandler.pruneInterval) {
      clearInterval(ClipHandler.pruneInterval);
      ClipHandler.pruneInterval = null;
    }

    console.log('ClipHandler: Stopped recording.');
  }

  /**
   * Subscribe to a user's audio stream.
   * Each subscription = one "speaking session" with contiguous PCM data.
   */
  private static subscribeToUser(userId: string, receiver: any) {
    const member = ClipHandler.guild?.members.cache.get(userId);
    const displayName = member?.displayName || member?.user?.username || userId;

    if (!ClipHandler.userBuffers.has(userId)) {
      ClipHandler.userBuffers.set(userId, {
        userId,
        displayName,
        sessions: [],
      });
    } else {
      ClipHandler.userBuffers.get(userId)!.displayName = displayName;
    }

    // Create a new speaking session
    const session: SpeakingSession = {
      startTimestamp: Date.now(),
      pcmChunks: [],
      totalBytes: 0,
    };

    ClipHandler.activeSubscriptions.set(userId, session);

    try {
      const opusStream = receiver.subscribe(userId, {
        end: {
          behavior: EndBehaviorType.AfterSilence,
          duration: SILENCE_TIMEOUT_MS,
        },
      });

      const prism = require('prism-media');
      const decoder = new prism.opus.Decoder({
        rate: SAMPLE_RATE,
        channels: CHANNELS,
        frameSize: FRAME_SIZE,
      });

      const pcmStream = opusStream.pipe(decoder);

      pcmStream.on('data', (chunk: Buffer) => {
        // Append chunk sequentially — no timestamp per chunk needed
        const copied = Buffer.from(chunk);
        session.pcmChunks.push(copied);
        session.totalBytes += copied.length;
      });

      let finished = false;
      const finishSession = () => {
        if (finished) return;
        finished = true;
        ClipHandler.activeSubscriptions.delete(userId);
        // Only save sessions that have actual audio data
        if (session.totalBytes > 0) {
          const userBuf = ClipHandler.userBuffers.get(userId);
          if (userBuf) {
            userBuf.sessions.push(session);
          }
        }
      };

      pcmStream.on('end', finishSession);
      pcmStream.on('close', finishSession);

      pcmStream.on('error', (err: Error) => {
        console.error(`ClipHandler: PCM stream error for ${displayName}:`, err.message);
        finishSession();
      });

      opusStream.on('error', (err: Error) => {
        console.error(`ClipHandler: Opus stream error for ${displayName}:`, err.message);
        finishSession();
      });
    } catch (err) {
      console.error(`ClipHandler: Failed to subscribe to user ${displayName}:`, err);
      ClipHandler.activeSubscriptions.delete(userId);
    }
  }

  /**
   * Remove sessions older than the clip duration.
   */
  private static pruneOldData() {
    const cutoff = Date.now() - CLIP_DURATION_MS;
    for (const [userId, buffer] of ClipHandler.userBuffers) {
      buffer.sessions = buffer.sessions.filter(session => {
        return ClipHandler.sessionEndTime(session) >= cutoff;
      });
      if (buffer.sessions.length === 0 && !ClipHandler.activeSubscriptions.has(userId)) {
        ClipHandler.userBuffers.delete(userId);
      }
    }
  }

  /**
   * Handle the !clip command.
   */
  static async handleClip(message: Message) {
    if (!ClipHandler.isRecording) {
      message.reply(t('clip.notRecording'));
      return;
    }

    // Cooldown check
    const now = Date.now();
    const elapsed = now - ClipHandler.lastClipTimestamp;
    if (elapsed < CLIP_COOLDOWN_MS) {
      const remaining = Math.ceil((CLIP_COOLDOWN_MS - elapsed) / 1000);
      message.reply(t('clip.cooldown', { remaining }));
      return;
    }

    if (ClipHandler.userBuffers.size === 0) {
      message.reply(t('clip.noData'));
      return;
    }

    const cutoff = now - CLIP_DURATION_MS;
    let hasRecentData = false;
    for (const [, buffer] of ClipHandler.userBuffers) {
      const activeSession = ClipHandler.activeSubscriptions.get(buffer.userId);
      const allSessions = activeSession && activeSession.totalBytes > 0
        ? [...buffer.sessions, activeSession]
        : buffer.sessions;
      if (allSessions.some(s => s.startTimestamp >= cutoff || ClipHandler.sessionEndTime(s) >= cutoff)) {
        hasRecentData = true;
        break;
      }
    }

    if (!hasRecentData) {
      message.reply(t('clip.noRecentData'));
      return;
    }

    ClipHandler.lastClipTimestamp = Date.now();

    const statusMsg = await message.reply(t('clip.processing'));

    try {
      if (!fs.existsSync(CLIPS_PATH)) {
        fs.mkdirSync(CLIPS_PATH, { recursive: true });
      }

      const timestamp = ClipHandler.formatTimestamp(new Date());
      const clipDir = path.join(CLIPS_PATH, `clip-${timestamp}`);
      fs.mkdirSync(clipDir, { recursive: true });

      const userPcmFiles: { displayName: string; pcmPath: string; mp3Path: string }[] = [];

      // Build per-user PCM files using session-based alignment
      for (const [userId, buffer] of ClipHandler.userBuffers) {
        // Snapshot the currently active session too
        const activeSession = ClipHandler.activeSubscriptions.get(userId);
        const allSessions = activeSession && activeSession.totalBytes > 0
          ? [...buffer.sessions, {
              startTimestamp: activeSession.startTimestamp,
              pcmChunks: [...activeSession.pcmChunks],
              totalBytes: activeSession.totalBytes,
            }]
          : [...buffer.sessions];

        // Filter to sessions within our time window
        const relevantSessions = allSessions.filter(s =>
          s.startTimestamp >= cutoff || ClipHandler.sessionEndTime(s) >= cutoff
        );

        if (relevantSessions.length === 0) continue;

        // Build timeline-aligned PCM using session boundaries
        const userPcm = ClipHandler.buildSessionAlignedPcm(relevantSessions, cutoff, now);

        const safeName = buffer.displayName.replace(/[^a-zA-Z0-9_\-\s]/g, '').replace(/\s+/g, '_');
        const fileName = `${safeName}_${timestamp}`;
        const pcmPath = path.join(clipDir, `${fileName}.pcm`);
        const mp3Path = path.join(clipDir, `${fileName}.mp3`);

        fs.writeFileSync(pcmPath, userPcm);
        userPcmFiles.push({ displayName: buffer.displayName, pcmPath, mp3Path });
      }

      if (userPcmFiles.length === 0) {
        await statusMsg.edit(t('clip.noAudioProcessed'));
        return;
      }

      // Convert individual PCM files to MP3
      for (const entry of userPcmFiles) {
        await ClipHandler.pcmToMp3(entry.pcmPath, entry.mp3Path);
      }

      // Mix all user PCM files into one MP3 using ffmpeg amix
      const mixedMp3Path = path.join(clipDir, `mixed_${timestamp}.mp3`);

      if (userPcmFiles.length === 1) {
        fs.copyFileSync(userPcmFiles[0].mp3Path, mixedMp3Path);
      } else {
        await ClipHandler.mixWithFfmpeg(
          userPcmFiles.map(u => u.pcmPath),
          mixedMp3Path
        );
      }

      // Clean up PCM files
      for (const entry of userPcmFiles) {
        fs.unlinkSync(entry.pcmPath);
      }

      // Create ZIP of individual user MP3 files
      const userMp3Paths = userPcmFiles.map(u => u.mp3Path);
      const zipPath = path.join(clipDir, `individual_${timestamp}.zip`);
      await ClipHandler.createZip(userMp3Paths, zipPath);

      const userList = userPcmFiles.map(u => u.displayName).join(', ');
      const filesToSend = [mixedMp3Path, zipPath];

      const totalSize = filesToSend.reduce((sum, f) => sum + fs.statSync(f).size, 0);
      const maxSize = 25 * 1024 * 1024;

      if (totalSize > maxSize) {
        await statusMsg.edit(
          t('clip.tooLarge', { size: (totalSize / 1024 / 1024).toFixed(1), path: clipDir })
        );
        return;
      }

      await message.channel.send({
        content: t('clip.success', { users: userList }),
        files: filesToSend,
      });

      await statusMsg.delete().catch(() => {});

    } catch (err) {
      console.error('ClipHandler: Error processing clip:', err);
      await statusMsg.edit(t('clip.error')).catch(() => {});
    }
  }

  /**
   * Calculate when a session ends based on its start time and data length.
   */
  private static sessionEndTime(session: SpeakingSession): number {
    const durationMs = (session.totalBytes / (SAMPLE_RATE * CHANNELS * BYTES_PER_SAMPLE)) * 1000;
    return session.startTimestamp + durationMs;
  }

  /**
   * Build a PCM buffer aligned to a timeline using session boundaries.
   *
   * Within each session, PCM frames are contiguous (no per-chunk timestamps).
   * Silence is inserted between sessions based on their start timestamps.
   * This avoids the jitter/click artifacts from per-chunk timestamp alignment.
   */
  private static buildSessionAlignedPcm(
    sessions: SpeakingSession[],
    startTime: number,
    endTime: number
  ): Buffer {
    const totalDurationMs = endTime - startTime;
    const totalBytes = Math.floor((totalDurationMs / 1000) * SAMPLE_RATE) * CHANNELS * BYTES_PER_SAMPLE;
    const output = Buffer.alloc(totalBytes); // zeros = silence

    // Sort sessions by start time
    const sorted = [...sessions].sort((a, b) => a.startTimestamp - b.startTimestamp);

    for (const session of sorted) {
      // Calculate where this session starts in the output buffer
      const offsetMs = Math.max(0, session.startTimestamp - startTime);
      // Snap to frame boundary to avoid mid-sample placement
      const offsetFrames = Math.round(offsetMs / FRAME_DURATION_MS);
      let writePos = offsetFrames * BYTES_PER_FRAME;

      // Concatenate all chunks in this session sequentially
      for (const chunk of session.pcmChunks) {
        if (writePos >= totalBytes) break;

        const bytesToCopy = Math.min(chunk.length, totalBytes - writePos);
        if (bytesToCopy > 0) {
          chunk.copy(output, writePos, 0, bytesToCopy);
          writePos += bytesToCopy;
        }
      }
    }

    return output;
  }

  /**
   * Mix multiple raw PCM files into a single MP3 using ffmpeg's amix filter.
   * This produces much better quality than manual sample addition.
   */
  private static mixWithFfmpeg(pcmPaths: string[], outputMp3Path: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const ffmpegPath = require('ffmpeg-static');

      const args: string[] = ['-y'];

      for (const pcmPath of pcmPaths) {
        args.push(
          '-f', 's16le',
          '-ar', String(SAMPLE_RATE),
          '-ac', String(CHANNELS),
          '-i', pcmPath
        );
      }

      // amix filter: combine all inputs, normalize to prevent clipping
      // Then enhance: band-pass voice frequencies, reduce noise, boost & normalize volume
      const inputCount = pcmPaths.length;
      args.push(
        '-filter_complex',
        `amix=inputs=${inputCount}:duration=longest:dropout_transition=0:normalize=1,` +
        `highpass=f=80,lowpass=f=12000,` +                   // keep voice-band frequencies
        `afftdn=nf=-20:nt=w,` +                              // FFT-based noise reduction
        `volume=2.0,` +                                      // boost overall volume
        `dynaudnorm=f=150:g=15:p=0.95:m=10:s=5`,            // dynamic normalization for even loudness
        '-codec:a', 'libmp3lame',
        '-b:a', '192k',
        outputMp3Path
      );

      const ffmpeg = spawn(ffmpegPath, args);

      let stderr = '';
      ffmpeg.stderr?.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      ffmpeg.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`ffmpeg mix exited with code ${code}: ${stderr}`));
        }
      });

      ffmpeg.on('error', (err) => {
        reject(new Error(`ffmpeg mix spawn error: ${err.message}`));
      });
    });
  }

  /**
   * Convert raw PCM file to MP3 using ffmpeg with high quality settings.
   */
  private static pcmToMp3(pcmPath: string, mp3Path: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const ffmpegPath = require('ffmpeg-static');
      const ffmpeg = spawn(ffmpegPath, [
        '-y',
        '-f', 's16le',
        '-ar', String(SAMPLE_RATE),
        '-ac', String(CHANNELS),
        '-i', pcmPath,
        '-af', [
          'highpass=f=80',              // remove low-frequency rumble
          'lowpass=f=12000',            // remove high-frequency hiss
          'afftdn=nf=-20:nt=w',        // FFT-based noise reduction
          'volume=2.0',                 // boost quiet audio
          'dynaudnorm=f=150:g=15:p=0.95:m=10:s=5',  // even out volume levels
        ].join(','),
        '-codec:a', 'libmp3lame',
        '-b:a', '192k',                // 192kbps CBR for clear voice
        mp3Path,
      ]);

      let stderr = '';
      ffmpeg.stderr?.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      ffmpeg.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`ffmpeg exited with code ${code}: ${stderr}`));
        }
      });

      ffmpeg.on('error', (err) => {
        reject(new Error(`ffmpeg spawn error: ${err.message}`));
      });
    });
  }

  /**
   * Create a ZIP file containing the given files.
   */
  private static createZip(files: string[], zipPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const output = fs.createWriteStream(zipPath);
      const archive = archiver('zip', { zlib: { level: 9 } });

      output.on('close', () => resolve());
      archive.on('error', (err) => reject(err));

      archive.pipe(output);

      for (const file of files) {
        archive.file(file, { name: path.basename(file) });
      }

      archive.finalize();
    });
  }

  /**
   * Format a date into a filename-safe timestamp.
   */
  private static formatTimestamp(date: Date): string {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`;
  }
}
