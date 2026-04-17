import type { IncomingMessage, ServerResponse } from 'http';
import { verifySignature } from './_verify';

interface VercelRequest extends IncomingMessage {
  query: { [key: string]: string | string[] | undefined };
}

interface VercelResponse extends ServerResponse {
  status(code: number): VercelResponse;
  json(body: any): VercelResponse;
  setHeader(name: string, value: string): this;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { c: channelId, m: messageId, f: filename, s: signature } = req.query;

  if (
    !channelId || !messageId || !filename ||
    typeof channelId !== 'string' || typeof messageId !== 'string' || typeof filename !== 'string'
  ) {
    return res.status(400).json({ error: 'Missing channelId (c), messageId (m), or filename (f)' });
  }

  // Validate snowflake format
  if (!/^\d{17,20}$/.test(channelId) || !/^\d{17,20}$/.test(messageId)) {
    return res.status(400).json({ error: 'Invalid ID format' });
  }

  // Verify HMAC signature
  const sig = typeof signature === 'string' ? signature : undefined;
  if (!verifySignature(channelId, messageId, sig)) {
    return res.status(403).json({ error: 'Invalid signature' });
  }

  // Validate filename (alphanumeric, dashes, underscores, dots only)
  if (!/^[\w\-. ]+$/.test(filename)) {
    return res.status(400).json({ error: 'Invalid filename' });
  }

  const botToken = process.env.DISCORD_BOT_TOKEN;
  if (!botToken) {
    return res.status(500).json({ error: 'Bot token not configured' });
  }

  try {
    // Fetch message to get fresh attachment URL
    const msgResponse = await fetch(
      `https://discord.com/api/v10/channels/${channelId}/messages/${messageId}`,
      { headers: { Authorization: `Bot ${botToken}` } }
    );

    if (!msgResponse.ok) {
      return res.status(404).json({ error: 'Message not found' });
    }

    const message = await msgResponse.json();
    const attachment = (message.attachments || []).find(
      (a: any) => a.filename === filename && a.content_type?.startsWith('audio/')
    );

    if (!attachment) {
      return res.status(404).json({ error: 'Audio attachment not found' });
    }

    // Fetch the actual audio file from Discord CDN
    const audioResponse = await fetch(attachment.url);
    if (!audioResponse.ok || !audioResponse.body) {
      return res.status(502).json({ error: 'Failed to fetch audio from Discord' });
    }

    const audioBuffer = await audioResponse.arrayBuffer();

    res.setHeader('Content-Type', attachment.content_type || 'audio/mpeg');
    res.setHeader('Content-Length', String(audioBuffer.byteLength));
    res.setHeader('Cache-Control', 's-maxage=300');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.end(Buffer.from(audioBuffer));
  } catch (err) {
    console.error('Proxy error:', err);
    return res.status(500).json({ error: 'Failed to proxy audio' });
  }
}
