import {
  type VoiceConnection,
  EndBehaviorType,
} from '@discordjs/voice';
import type { Message, Guild } from 'discord.js';
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import archiver from 'archiver';

const CLIP_DURATION_MS = 60_000; // 1 minute rolling buffer
const SAMPLE_RATE = 48000;
const CHANNELS = 2;
const BYTES_PER_SAMPLE = 2; // 16-bit signed LE
const PRUNE_INTERVAL_MS = 10_000;
const SILENCE_TIMEOUT_MS = 2000; // re-subscribe after 2s silence
const CLIPS_PATH = './src/assets/clips';

interface AudioChunk {
  timestamp: number;
  data: Buffer;
}

interface UserAudioBuffer {
  userId: string;
  displayName: string;
  chunks: AudioChunk[];
}

export class ClipHandler {
  private static userBuffers: Map<string, UserAudioBuffer> = new Map();
  private static activeSubscriptions: Set<string> = new Set();
  private static isRecording = false;
  private static connection: VoiceConnection | null = null;
  private static guild: Guild | null = null;
  private static pruneInterval: NodeJS.Timeout | null = null;
  private static speakingHandler: ((userId: string) => void) | null = null;

  /**
   * Start recording audio from all users in the voice channel.
   * Call this when the bot's voice connection becomes Ready.
   */
  static startRecording(connection: VoiceConnection, guild: Guild) {
    // If already recording on the same connection, skip
    if (ClipHandler.isRecording && ClipHandler.connection === connection) return;

    // If recording on a different connection, stop first
    if (ClipHandler.isRecording) {
      ClipHandler.stopRecording();
    }

    ClipHandler.connection = connection;
    ClipHandler.guild = guild;
    ClipHandler.isRecording = true;

    const receiver = connection.receiver;

    // Handler for when a user starts speaking
    ClipHandler.speakingHandler = (userId: string) => {
      if (!ClipHandler.isRecording) return;
      if (ClipHandler.activeSubscriptions.has(userId)) return;
      ClipHandler.subscribeToUser(userId, receiver);
    };

    receiver.speaking.on('start', ClipHandler.speakingHandler);

    // Prune old audio data periodically
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
        // Ignore if already removed
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
   * Subscribe to a user's audio stream and buffer their PCM data.
   */
  private static subscribeToUser(userId: string, receiver: any) {
    ClipHandler.activeSubscriptions.add(userId);

    // Get display name from guild cache
    const member = ClipHandler.guild?.members.cache.get(userId);
    const displayName = member?.displayName || member?.user?.username || userId;

    if (!ClipHandler.userBuffers.has(userId)) {
      ClipHandler.userBuffers.set(userId, {
        userId,
        displayName,
        chunks: [],
      });
    } else {
      // Update display name in case it changed
      const buf = ClipHandler.userBuffers.get(userId)!;
      buf.displayName = displayName;
    }

    try {
      const opusStream = receiver.subscribe(userId, {
        end: {
          behavior: EndBehaviorType.AfterSilence,
          duration: SILENCE_TIMEOUT_MS,
        },
      });

      // Decode Opus to PCM using prism-media (ships with @discordjs/voice)
      const prism = require('prism-media');
      const decoder = new prism.opus.Decoder({
        rate: SAMPLE_RATE,
        channels: CHANNELS,
        frameSize: 960,
      });

      const pcmStream = opusStream.pipe(decoder);

      pcmStream.on('data', (chunk: Buffer) => {
        const buffer = ClipHandler.userBuffers.get(userId);
        if (buffer) {
          buffer.chunks.push({
            timestamp: Date.now(),
            data: Buffer.from(chunk), // copy to avoid buffer reuse issues
          });
        }
      });

      pcmStream.on('end', () => {
        ClipHandler.activeSubscriptions.delete(userId);
      });

      pcmStream.on('close', () => {
        ClipHandler.activeSubscriptions.delete(userId);
      });

      pcmStream.on('error', (err: Error) => {
        console.error(`ClipHandler: PCM stream error for ${displayName}:`, err.message);
        ClipHandler.activeSubscriptions.delete(userId);
      });

      opusStream.on('error', (err: Error) => {
        console.error(`ClipHandler: Opus stream error for ${displayName}:`, err.message);
        ClipHandler.activeSubscriptions.delete(userId);
      });
    } catch (err) {
      console.error(`ClipHandler: Failed to subscribe to user ${displayName}:`, err);
      ClipHandler.activeSubscriptions.delete(userId);
    }
  }

  /**
   * Remove audio chunks older than the clip duration.
   */
  private static pruneOldData() {
    const cutoff = Date.now() - CLIP_DURATION_MS;
    for (const [userId, buffer] of ClipHandler.userBuffers) {
      buffer.chunks = buffer.chunks.filter(chunk => chunk.timestamp >= cutoff);
      if (buffer.chunks.length === 0) {
        ClipHandler.userBuffers.delete(userId);
      }
    }
  }

  /**
   * Handle the !clip command: export the last 60 seconds of audio.
   * Sends a mixed MP3 + a ZIP with individual user MP3 files.
   */
  static async handleClip(message: Message) {
    if (!ClipHandler.isRecording) {
      message.reply('⚠️ Not currently recording. The bot needs to be in a voice channel.');
      return;
    }

    if (ClipHandler.userBuffers.size === 0) {
      message.reply('⚠️ No audio data recorded yet. Make sure people are talking in the voice channel.');
      return;
    }

    // Check if there is any recent data
    const now = Date.now();
    const cutoff = now - CLIP_DURATION_MS;
    let hasRecentData = false;
    for (const [, buffer] of ClipHandler.userBuffers) {
      if (buffer.chunks.some(c => c.timestamp >= cutoff)) {
        hasRecentData = true;
        break;
      }
    }

    if (!hasRecentData) {
      message.reply('⚠️ No audio data in the last 60 seconds.');
      return;
    }

    const statusMsg = await message.reply('🎙️ Processing clip... This may take a few seconds.');

    try {
      // Ensure clips directory exists
      if (!fs.existsSync(CLIPS_PATH)) {
        fs.mkdirSync(CLIPS_PATH, { recursive: true });
      }

      const timestamp = ClipHandler.formatTimestamp(new Date());
      const clipDir = path.join(CLIPS_PATH, `clip-${timestamp}`);
      fs.mkdirSync(clipDir, { recursive: true });

      const userMp3Files: string[] = [];
      const userPcmBuffers: { displayName: string; pcm: Buffer }[] = [];

      // Process each user's audio
      for (const [userId, buffer] of ClipHandler.userBuffers) {
        const relevantChunks = buffer.chunks.filter(c => c.timestamp >= cutoff);
        if (relevantChunks.length === 0) continue;

        // Build a timeline-aligned PCM buffer (silence where user wasn't speaking)
        const userPcm = ClipHandler.buildAlignedPcm(relevantChunks, cutoff, now);
        const safeName = buffer.displayName.replace(/[^a-zA-Z0-9_\-\s]/g, '').replace(/\s+/g, '_');
        const fileName = `${safeName}_${timestamp}`;

        userPcmBuffers.push({ displayName: buffer.displayName, pcm: userPcm });

        // Convert individual user PCM to MP3
        const pcmPath = path.join(clipDir, `${fileName}.pcm`);
        const mp3Path = path.join(clipDir, `${fileName}.mp3`);

        fs.writeFileSync(pcmPath, userPcm);
        await ClipHandler.pcmToMp3(pcmPath, mp3Path);
        fs.unlinkSync(pcmPath); // clean up PCM

        userMp3Files.push(mp3Path);
      }

      if (userMp3Files.length === 0) {
        await statusMsg.edit('⚠️ No audio data could be processed.');
        return;
      }

      // Mix all PCM buffers into a combined MP3
      const allPcmData = userPcmBuffers.map(u => u.pcm);
      const mixedPcm = ClipHandler.mixPcmBuffers(allPcmData);
      const mixedPcmPath = path.join(clipDir, `mixed_${timestamp}.pcm`);
      const mixedMp3Path = path.join(clipDir, `mixed_${timestamp}.mp3`);

      fs.writeFileSync(mixedPcmPath, mixedPcm);
      await ClipHandler.pcmToMp3(mixedPcmPath, mixedMp3Path);
      fs.unlinkSync(mixedPcmPath); // clean up PCM

      // Create ZIP of individual user MP3 files
      const zipPath = path.join(clipDir, `individual_${timestamp}.zip`);
      await ClipHandler.createZip(userMp3Files, zipPath);

      // Build description of who was recorded
      const userList = userPcmBuffers.map(u => u.displayName).join(', ');

      // Send files to channel
      const filesToSend = [mixedMp3Path, zipPath];

      // Check total file size (Discord limit: 25MB for most servers)
      const totalSize = filesToSend.reduce((sum, f) => sum + fs.statSync(f).size, 0);
      const maxSize = 25 * 1024 * 1024; // 25MB

      if (totalSize > maxSize) {
        await statusMsg.edit(
          `⚠️ The clip files are too large to upload (${(totalSize / 1024 / 1024).toFixed(1)}MB). Files saved locally at: \`${clipDir}\``
        );
        return;
      }

      await message.channel.send({
        content: `🎙️ **Voice Clip** (last 60 seconds)\n👥 **Recorded:** ${userList}\n📁 Mixed MP3 + ZIP with individual tracks`,
        files: filesToSend,
      });

      await statusMsg.delete().catch(() => {});

    } catch (err) {
      console.error('ClipHandler: Error processing clip:', err);
      await statusMsg.edit('❌ An error occurred while processing the clip. Check console for details.').catch(() => {});
    }
  }

  /**
   * Build a PCM buffer aligned to a timeline, filling silence where no data exists.
   */
  private static buildAlignedPcm(chunks: AudioChunk[], startTime: number, endTime: number): Buffer {
    const totalDurationMs = endTime - startTime;
    const totalSamples = Math.floor((totalDurationMs / 1000) * SAMPLE_RATE);
    const totalBytes = totalSamples * CHANNELS * BYTES_PER_SAMPLE;
    const output = Buffer.alloc(totalBytes); // zeros = silence

    for (const chunk of chunks) {
      const offsetMs = chunk.timestamp - startTime;
      const offsetSamples = Math.floor((offsetMs / 1000) * SAMPLE_RATE);
      const offsetBytes = offsetSamples * CHANNELS * BYTES_PER_SAMPLE;

      if (offsetBytes >= 0 && offsetBytes + chunk.data.length <= totalBytes) {
        chunk.data.copy(output, offsetBytes);
      } else if (offsetBytes >= 0 && offsetBytes < totalBytes) {
        // Partial copy at the end
        const bytesToCopy = Math.min(chunk.data.length, totalBytes - offsetBytes);
        chunk.data.copy(output, offsetBytes, 0, bytesToCopy);
      }
    }

    return output;
  }

  /**
   * Mix multiple PCM buffers together by summing samples with clamping.
   */
  private static mixPcmBuffers(buffers: Buffer[]): Buffer {
    if (buffers.length === 0) return Buffer.alloc(0);
    if (buffers.length === 1) return Buffer.from(buffers[0]);

    const maxLength = Math.max(...buffers.map(b => b.length));
    const output = Buffer.alloc(maxLength);

    for (let i = 0; i < maxLength; i += BYTES_PER_SAMPLE) {
      let mixed = 0;
      for (const buf of buffers) {
        if (i + 1 < buf.length) {
          mixed += buf.readInt16LE(i);
        }
      }
      // Clamp to signed 16-bit range
      mixed = Math.max(-32768, Math.min(32767, mixed));
      output.writeInt16LE(mixed, i);
    }

    return output;
  }

  /**
   * Convert raw PCM file to MP3 using ffmpeg.
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
        '-codec:a', 'libmp3lame',
        '-qscale:a', '2',
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
