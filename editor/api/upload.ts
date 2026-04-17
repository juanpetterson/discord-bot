import type { IncomingMessage, ServerResponse } from 'http';
import { verifySignature } from './_verify';

interface VercelRequest extends IncomingMessage {
  query: { [key: string]: string | string[] | undefined };
  body: any;
}

interface VercelResponse extends ServerResponse {
  status(code: number): VercelResponse;
  json(body: any): VercelResponse;
  setHeader(name: string, value: string): this;
}

export const config = {
  api: { bodyParser: { sizeLimit: '10mb' } },
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { c: channelId, m: messageId, s: sig } = req.query;

  if (
    !channelId || !messageId ||
    typeof channelId !== 'string' || typeof messageId !== 'string'
  ) {
    return res.status(400).json({ error: 'Missing channelId (c) or messageId (m)' });
  }

  // Verify editor signature (same as other endpoints)
  const editorSig = typeof sig === 'string' ? sig : undefined;
  if (!verifySignature(channelId, messageId, editorSig)) {
    return res.status(403).json({ error: 'Invalid editor signature' });
  }

  const { author, soundName, audioBase64 } = req.body || {};

  if (!author || !soundName || !audioBase64) {
    return res.status(400).json({ error: 'Missing author, soundName, or audioBase64' });
  }

  if (typeof author !== 'string' || typeof soundName !== 'string' || typeof audioBase64 !== 'string') {
    return res.status(400).json({ error: 'Invalid field types' });
  }

  if (author.length > 50 || soundName.length > 100) {
    return res.status(400).json({ error: 'Author or sound name too long' });
  }

  // Sanitize
  const safeAuthor = author.replace(/[^a-zA-Z0-9_\-\s]/g, '').trim();
  const safeName = soundName.replace(/[^a-zA-Z0-9_\-\s]/g, '').trim();
  if (!safeAuthor || !safeName) {
    return res.status(400).json({ error: 'Invalid author or sound name' });
  }

  const audioBuffer = Buffer.from(audioBase64, 'base64');
  if (audioBuffer.length > 10 * 1024 * 1024) {
    return res.status(400).json({ error: 'Audio file too large (max 10MB)' });
  }

  const botToken = process.env.DISCORD_BOT_TOKEN;
  if (!botToken) {
    return res.status(500).json({ error: 'Bot token not configured' });
  }

  const fileName = `${safeAuthor} - ${safeName}.wav`;

  try {
    // Upload to Discord as a message attachment in the same channel
    const formData = new FormData();
    const blob = new Blob([audioBuffer], { type: 'audio/wav' });
    formData.append('files[0]', blob, fileName);
    formData.append('payload_json', JSON.stringify({
      content: `🔊 **Sound Upload** from Web Editor\n📁 \`${fileName}\`\n⚙️ _Processing..._`,
    }));

    const response = await fetch(
      `https://discord.com/api/v10/channels/${channelId}/messages`,
      {
        method: 'POST',
        headers: { Authorization: `Bot ${botToken}` },
        body: formData,
      }
    );

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      console.error('Discord send error:', err);
      return res.status(502).json({ error: 'Failed to send to Discord' });
    }

    return res.json({ success: true, fileName });
  } catch (err) {
    console.error('Upload error:', err);
    return res.status(500).json({ error: 'Failed to upload sound' });
  }
}
