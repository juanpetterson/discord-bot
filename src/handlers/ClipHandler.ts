import {
  type VoiceConnection,
  EndBehaviorType,
} from '@discordjs/voice';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  type ButtonInteraction,
  type StringSelectMenuInteraction,
  type ModalSubmitInteraction,
  type Guild,
  type Message,
  type TextBasedChannel,
} from 'discord.js';
import { spawn } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import archiver from 'archiver';

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
const CLIP_METADATA_TTL_MS = 10 * 60 * 1000; // 10 minutes

interface ClipTrack {
  displayName: string;
  fileName: string; // just the basename
}

interface ClipMetadata {
  clipId: string;
  clipDir: string;
  mixedFileName: string;
  tracks: ClipTrack[];
  channelId: string;
  createdAt: number;
}

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
  static readonly BUTTON_CUSTOM_ID = 'clip_execute';
  static readonly TRIM_BUTTON_PREFIX = 'clip_trim_';
  static readonly TRACK_SELECT_PREFIX = 'clip_track_';
  static readonly TRIM_MODAL_PREFIX = 'clip_modal_';
  static readonly UPLOAD_BUTTON_PREFIX = 'clip_upload_';
  static readonly UPLOAD_MODAL_PREFIX = 'clip_uploadm_';

  private static clipMetadataStore: Map<string, ClipMetadata> = new Map();
  private static trimmedFileStore: Map<string, string> = new Map(); // shortId -> filePath
  private static trimModalStore: Map<string, { clipId: string; trackValue: string }> = new Map();
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
  static async handleClip(message: Pick<Message, 'reply' | 'channel'>) {
    if (!ClipHandler.isRecording) {
      message.reply('⚠️ Not currently recording. The bot needs to be in a voice channel.');
      return;
    }

    // Cooldown check
    const now = Date.now();
    const elapsed = now - ClipHandler.lastClipTimestamp;
    if (elapsed < CLIP_COOLDOWN_MS) {
      const remaining = Math.ceil((CLIP_COOLDOWN_MS - elapsed) / 1000);
      message.reply(`⏳ Clip is on cooldown. Try again in **${remaining}s**.`);
      return;
    }

    if (ClipHandler.userBuffers.size === 0) {
      message.reply('⚠️ No audio data recorded yet. Make sure people are talking in the voice channel.');
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
      message.reply('⚠️ No audio data in the last 60 seconds.');
      return;
    }

    ClipHandler.lastClipTimestamp = Date.now();

    const statusMsg = await message.reply('🎙️ Processing clip... This may take a few seconds.');

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
        await statusMsg.edit('⚠️ No audio data could be processed.');
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

      const userList = userPcmFiles.map(u => u.displayName).join(', ');
      const filesToSend = [mixedMp3Path, ...userPcmFiles.map(u => u.mp3Path)];

      // Store clip metadata for trim features
      const clipId = crypto.randomUUID();
      const tracks: ClipTrack[] = userPcmFiles.map(u => ({
        displayName: u.displayName,
        fileName: path.basename(u.mp3Path),
      }));
      const metadata: ClipMetadata = {
        clipId,
        clipDir: clipDir,
        mixedFileName: path.basename(mixedMp3Path),
        tracks,
        channelId: message.channel.id,
        createdAt: Date.now(),
      };
      ClipHandler.clipMetadataStore.set(clipId, metadata);
      ClipHandler.pruneExpiredClips();

      const clipButton = new ButtonBuilder()
        .setCustomId(ClipHandler.BUTTON_CUSTOM_ID)
        .setLabel('CLIP')
        .setStyle(ButtonStyle.Primary);
      const trimButton = new ButtonBuilder()
        .setCustomId(`${ClipHandler.TRIM_BUTTON_PREFIX}${clipId}`)
        .setLabel('✂️ Trim')
        .setStyle(ButtonStyle.Secondary);

      const clipButtonRow = new ActionRowBuilder<ButtonBuilder>().addComponents(clipButton, trimButton);

      const totalSize = filesToSend.reduce((sum, f) => sum + fs.statSync(f).size, 0);
      const maxSize = 25 * 1024 * 1024;

      if (totalSize > maxSize) {
        await statusMsg.edit(
          `⚠️ The clip files are too large to upload (${(totalSize / 1024 / 1024).toFixed(1)}MB). Files saved locally at: \`${clipDir}\``
        );
        return;
      }

      const sentMessage = await message.channel.send({
        content: `🎙️ **Voice Clip** (last 60 seconds)\n👥 **Recorded:** ${userList}\n📁 Mixed MP3 + individual tracks`,
        files: filesToSend,
        components: [clipButtonRow],
      });

      // Add Editor button if Vercel editor URL is configured
      const editorBaseUrl = process.env.CLIP_EDITOR_BASE_URL;
      if (editorBaseUrl && sentMessage) {
        try {
          const hashData = Buffer.from(JSON.stringify({
            c: message.channel.id,
            m: sentMessage.id,
          })).toString('base64url');
          const editorUrl = `${editorBaseUrl}#${hashData}`;

          if (editorUrl.length <= 512) {
            const editorButton = new ButtonBuilder()
              .setLabel('🎛️ Editor')
              .setStyle(ButtonStyle.Link)
              .setURL(editorUrl);
            const updatedRow = new ActionRowBuilder<ButtonBuilder>().addComponents(clipButton, trimButton, editorButton);
            await sentMessage.edit({ components: [updatedRow] });
          }
        } catch (err) {
          console.error('ClipHandler: Failed to add editor button:', err);
        }
      }

      await statusMsg.delete().catch(() => {});

    } catch (err) {
      console.error('ClipHandler: Error processing clip:', err);
      await statusMsg.edit('❌ An error occurred while processing the clip. Check console for details.').catch(() => {});
    }
  }

  static isClipButton(customId: string): boolean {
    return customId === ClipHandler.BUTTON_CUSTOM_ID;
  }

  static async handleClipButton(interaction: ButtonInteraction) {
    if (!interaction.channel) {
      await interaction.reply({ content: '⚠️ Could not determine channel for this clip.', ephemeral: true }).catch(() => {});
      return;
    }

    await interaction.deferUpdate().catch(() => {});

    const context = {
      reply: (options: Parameters<Message['reply']>[0]) => interaction.channel!.send(options as any),
      channel: interaction.channel,
    } as Pick<Message, 'reply' | 'channel'>;

    await ClipHandler.handleClip(context);
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
      const inputCount = pcmPaths.length;
      args.push(
        '-filter_complex',
        `amix=inputs=${inputCount}:duration=longest:dropout_transition=0:normalize=1`,
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
        '-codec:a', 'libmp3lame',
        '-b:a', '192k',       // 192kbps CBR for clear voice
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

  // ========== Clip Metadata ==========

  private static pruneExpiredClips() {
    const now = Date.now();
    for (const [id, meta] of ClipHandler.clipMetadataStore) {
      if (now - meta.createdAt > CLIP_METADATA_TTL_MS) {
        ClipHandler.clipMetadataStore.delete(id);
      }
    }
  }

  static getClipMetadata(clipId: string): ClipMetadata | undefined {
    ClipHandler.pruneExpiredClips();
    return ClipHandler.clipMetadataStore.get(clipId);
  }

  // ========== Discord Trim Flow ==========

  static isTrimButton(customId: string): boolean {
    return customId.startsWith(ClipHandler.TRIM_BUTTON_PREFIX);
  }

  static isTrackSelect(customId: string): boolean {
    return customId.startsWith(ClipHandler.TRACK_SELECT_PREFIX);
  }

  static isTrimModal(customId: string): boolean {
    return customId.startsWith(ClipHandler.TRIM_MODAL_PREFIX);
  }

  static async handleTrimButton(interaction: ButtonInteraction) {
    const clipId = interaction.customId.substring(ClipHandler.TRIM_BUTTON_PREFIX.length);
    const meta = ClipHandler.getClipMetadata(clipId);

    if (!meta) {
      await interaction.reply({ content: '⚠️ This clip has expired (10 min TTL). Create a new clip with `!clip`.', ephemeral: true });
      return;
    }

    const options = [
      { label: '🎵 Mixed Audio', value: `mixed::${meta.mixedFileName}` },
      ...meta.tracks.map(t => ({
        label: `🎤 ${t.displayName}`,
        value: `individual::${t.fileName}`,
      })),
    ];

    const selectMenu = new StringSelectMenuBuilder()
      .setCustomId(`${ClipHandler.TRACK_SELECT_PREFIX}${clipId}`)
      .setPlaceholder('Select a track to trim')
      .addOptions(options.slice(0, 25)); // Discord limit

    const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(selectMenu);

    await interaction.reply({
      content: '🎵 **Select the track you want to trim:**',
      components: [row],
      ephemeral: true,
    });
  }

  static async handleTrackSelect(interaction: StringSelectMenuInteraction) {
    const clipId = interaction.customId.substring(ClipHandler.TRACK_SELECT_PREFIX.length);
    const selectedValue = interaction.values[0];
    const trimModalId = crypto.randomUUID();
    ClipHandler.trimModalStore.set(trimModalId, { clipId, trackValue: selectedValue });
    const modalId = `${ClipHandler.TRIM_MODAL_PREFIX}${trimModalId}`;

    const modal = new ModalBuilder()
      .setCustomId(modalId)
      .setTitle('✂️ Trim Audio');

    const startInput = new TextInputBuilder()
      .setCustomId('trim_start')
      .setLabel('Start Time (mm:ss)')
      .setPlaceholder('00:00')
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setMaxLength(5);

    const endInput = new TextInputBuilder()
      .setCustomId('trim_end')
      .setLabel('End Time (mm:ss)')
      .setPlaceholder('01:00')
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setMaxLength(5);

    modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(startInput),
      new ActionRowBuilder<TextInputBuilder>().addComponents(endInput),
    );

    await interaction.showModal(modal);
  }

  static async handleTrimModal(interaction: ModalSubmitInteraction) {
    const trimModalId = interaction.customId.substring(ClipHandler.TRIM_MODAL_PREFIX.length);
    const stored = ClipHandler.trimModalStore.get(trimModalId);

    if (!stored) {
      await interaction.reply({ content: '⚠️ This trim session has expired. Please start again.', ephemeral: true });
      return;
    }

    const { clipId, trackValue } = stored;

    const meta = ClipHandler.getClipMetadata(clipId);
    if (!meta) {
      await interaction.reply({ content: '⚠️ This clip has expired. Create a new clip with `!clip`.', ephemeral: true });
      return;
    }
    const [trackType, trackFileName] = trackValue.split('::');

    // Validate trackFileName against metadata
    const validFiles = [meta.mixedFileName, ...meta.tracks.map(t => t.fileName)];
    if (!validFiles.includes(trackFileName)) {
      await interaction.reply({ content: '⚠️ Invalid track selection.', ephemeral: true });
      return;
    }

    const startStr = interaction.fields.getTextInputValue('trim_start');
    const endStr = interaction.fields.getTextInputValue('trim_end');

    const startMs = ClipHandler.parseTimeToMs(startStr);
    const endMs = ClipHandler.parseTimeToMs(endStr);

    if (startMs === null || endMs === null) {
      await interaction.reply({ content: '⚠️ Invalid time format. Use `mm:ss` (e.g., `00:10`).', ephemeral: true });
      return;
    }

    if (endMs <= startMs) {
      await interaction.reply({ content: '⚠️ End time must be after start time.', ephemeral: true });
      return;
    }

    await interaction.deferReply();

    try {
      const inputPath = path.join(meta.clipDir, trackFileName);
      if (!fs.existsSync(inputPath)) {
        await interaction.editReply('⚠️ Audio file not found. It may have been cleaned up.');
        return;
      }

      const trimmedFileName = `trimmed_${path.basename(trackFileName, '.mp3')}_${startStr.replace(':', '-')}_${endStr.replace(':', '-')}.mp3`;
      const outputPath = path.join(meta.clipDir, trimmedFileName);

      await ClipHandler.trimMp3(inputPath, outputPath, startMs, endMs);

      const trackLabel = trackType === 'mixed' ? 'Mixed Audio' : meta.tracks.find(t => t.fileName === trackFileName)?.displayName || trackFileName;

      const trimId = crypto.randomUUID();
      ClipHandler.trimmedFileStore.set(trimId, outputPath);
      const uploadButton = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(`${ClipHandler.UPLOAD_BUTTON_PREFIX}${trimId}`)
          .setLabel('💾 Upload as Sound')
          .setStyle(ButtonStyle.Success),
      );

      await interaction.editReply({
        content: `✂️ **Trimmed Clip** — ${trackLabel} (${startStr} → ${endStr})`,
        files: [outputPath],
        components: [uploadButton],
      });
    } catch (err) {
      console.error('ClipHandler: Error trimming clip:', err);
      await interaction.editReply('❌ An error occurred while trimming the clip.');
    }
  }

  // ========== API Helpers (for web editor) ==========

  static getClipAudioPath(clipId: string, trackFile: string): string | null {
    const meta = ClipHandler.getClipMetadata(clipId);
    if (!meta) return null;

    // Validate trackFile against known files to prevent path traversal
    const validFiles = [meta.mixedFileName, ...meta.tracks.map(t => t.fileName)];
    const safeName = path.basename(trackFile);
    if (!validFiles.includes(safeName)) return null;

    const fullPath = path.join(meta.clipDir, safeName);
    if (!fs.existsSync(fullPath)) return null;
    return fullPath;
  }

  static async trimAndGetPath(clipId: string, trackFile: string, startMs: number, endMs: number): Promise<string | null> {
    const meta = ClipHandler.getClipMetadata(clipId);
    if (!meta) return null;

    const validFiles = [meta.mixedFileName, ...meta.tracks.map(t => t.fileName)];
    const safeName = path.basename(trackFile);
    if (!validFiles.includes(safeName)) return null;

    const inputPath = path.join(meta.clipDir, safeName);
    if (!fs.existsSync(inputPath)) return null;

    if (endMs <= startMs || startMs < 0) return null;

    const startStr = ClipHandler.formatMsToTime(startMs);
    const endStr = ClipHandler.formatMsToTime(endMs);
    const trimmedFileName = `trimmed_${path.basename(safeName, '.mp3')}_${startStr.replace(':', '-')}_${endStr.replace(':', '-')}.mp3`;
    const outputPath = path.join(meta.clipDir, trimmedFileName);

    await ClipHandler.trimMp3(inputPath, outputPath, startMs, endMs);
    return outputPath;
  }

  static async postTrimmedToChannel(clipId: string, trimmedPath: string, trackLabel: string, startStr: string, endStr: string): Promise<boolean> {
    const meta = ClipHandler.getClipMetadata(clipId);
    if (!meta) return false;

    try {
      const { client } = require('../index');
      const channel = client.channels.cache.get(meta.channelId) as TextBasedChannel | undefined;
      if (!channel) return false;

      const trimId = crypto.randomUUID();
      ClipHandler.trimmedFileStore.set(trimId, trimmedPath);
      const uploadButton = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(`${ClipHandler.UPLOAD_BUTTON_PREFIX}${trimId}`)
          .setLabel('💾 Upload as Sound')
          .setStyle(ButtonStyle.Success),
      );

      await channel.send({
        content: `✂️ **Trimmed Clip** — ${trackLabel} (${startStr} → ${endStr})`,
        files: [trimmedPath],
        components: [uploadButton],
      });
      return true;
    } catch (err) {
      console.error('ClipHandler: Error posting trimmed clip:', err);
      return false;
    }
  }

  // ========== Trim Utility ==========

  private static trimMp3(inputPath: string, outputPath: string, startMs: number, endMs: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const ffmpegPath = require('ffmpeg-static');
      const startSec = startMs / 1000;
      const endSec = endMs / 1000;

      const ffmpeg = spawn(ffmpegPath, [
        '-y',
        '-i', inputPath,
        '-ss', String(startSec),
        '-to', String(endSec),
        '-c', 'copy',
        outputPath,
      ]);

      let stderr = '';
      ffmpeg.stderr?.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      ffmpeg.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`ffmpeg trim exited with code ${code}: ${stderr}`));
        }
      });

      ffmpeg.on('error', (err) => {
        reject(new Error(`ffmpeg trim spawn error: ${err.message}`));
      });
    });
  }

  private static parseTimeToMs(timeStr: string): number | null {
    const match = timeStr.trim().match(/^(\d{1,2}):(\d{2})$/);
    if (!match) return null;
    const minutes = parseInt(match[1], 10);
    const seconds = parseInt(match[2], 10);
    if (seconds >= 60) return null;
    return (minutes * 60 + seconds) * 1000;
  }

  private static formatMsToTime(ms: number): string {
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }

  // ========== Upload as Sound Flow ==========

  static isUploadButton(customId: string): boolean {
    return customId.startsWith(ClipHandler.UPLOAD_BUTTON_PREFIX);
  }

  static isUploadModal(customId: string): boolean {
    return customId.startsWith(ClipHandler.UPLOAD_MODAL_PREFIX);
  }

  static async handleUploadButton(interaction: ButtonInteraction) {
    const trimId = interaction.customId.substring(ClipHandler.UPLOAD_BUTTON_PREFIX.length);
    const filePath = ClipHandler.trimmedFileStore.get(trimId);

    if (!filePath || !fs.existsSync(filePath)) {
      await interaction.reply({ content: '⚠️ The trimmed audio file has expired or been deleted.', ephemeral: true });
      return;
    }

    const modalId = `${ClipHandler.UPLOAD_MODAL_PREFIX}${trimId}`;

    const modal = new ModalBuilder()
      .setCustomId(modalId)
      .setTitle('📁 Upload as Sound');

    const authorInput = new TextInputBuilder()
      .setCustomId('upload_author')
      .setLabel('Author')
      .setPlaceholder('e.g. binho')
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setMaxLength(50);

    const nameInput = new TextInputBuilder()
      .setCustomId('upload_name')
      .setLabel('Sound Name')
      .setPlaceholder('e.g. funny-moment')
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setMaxLength(50);

    modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(authorInput),
      new ActionRowBuilder<TextInputBuilder>().addComponents(nameInput),
    );

    await interaction.showModal(modal);
  }

  static async handleUploadModal(interaction: ModalSubmitInteraction) {
    const trimId = interaction.customId.substring(ClipHandler.UPLOAD_MODAL_PREFIX.length);
    const sourcePath = ClipHandler.trimmedFileStore.get(trimId);

    if (!sourcePath || !fs.existsSync(sourcePath)) {
      await interaction.reply({ content: '⚠️ The trimmed audio file has expired or been deleted.', ephemeral: true });
      return;
    }

    const author = interaction.fields.getTextInputValue('upload_author').trim();
    const soundName = interaction.fields.getTextInputValue('upload_name').trim();

    if (!author || !soundName) {
      await interaction.reply({ content: '⚠️ Both Author and Sound Name are required.', ephemeral: true });
      return;
    }

    // Sanitize inputs to prevent path traversal
    const safeAuthor = author.replace(/[^a-zA-Z0-9_\-\s]/g, '').trim();
    const safeName = soundName.replace(/[^a-zA-Z0-9_\-\s]/g, '').trim();

    if (!safeAuthor || !safeName) {
      await interaction.reply({ content: '⚠️ Author and Sound Name can only contain letters, numbers, spaces, hyphens, and underscores.', ephemeral: true });
      return;
    }

    const PREFIX_SEPARATOR = ' - ';
    const destFileName = `${safeAuthor}${PREFIX_SEPARATOR}${safeName}.mp3`;
    const destPath = path.join('./src/assets/uploads', destFileName);

    try {
      fs.copyFileSync(sourcePath, destPath);
      await interaction.reply({
        content: `✅ Sound uploaded as **${destFileName}**!\nUse \`!play ${safeName}\` to play it.`,
      });
    } catch (err) {
      console.error('ClipHandler: Error uploading sound:', err);
      await interaction.reply({ content: '❌ Failed to upload sound.', ephemeral: true });
    }
  }
}
