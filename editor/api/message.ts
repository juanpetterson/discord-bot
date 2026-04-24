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

  const { c: channelId, m: messageId, s: signature } = req.query;

  if (!channelId || !messageId || typeof channelId !== 'string' || typeof messageId !== 'string') {
    return res.status(400).json({ error: 'Missing channelId (c) or messageId (m)' });
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

  const botToken = process.env.DISCORD_BOT_TOKEN;
  if (!botToken) {
    return res.status(500).json({ error: 'Bot token not configured' });
  }

  try {
    const response = await fetch(
      `https://discord.com/api/v10/channels/${channelId}/messages/${messageId}`,
      { headers: { Authorization: `Bot ${botToken}` } }
    );

    if (!response.ok) {
      return res.status(404).json({ error: 'Message not found' });
    }

    const message = await response.json();
    const attachments = (message.attachments || [])
      .filter((a: any) => a.content_type?.startsWith('audio/'))
      .map((a: any) => ({
        filename: a.filename,
        url: a.url,
        size: a.size,
      }));

    if (attachments.length === 0) {
      return res.status(404).json({ error: 'No audio attachments found' });
    }

    // Cache for 5 minutes (attachment signing URLs are valid for hours)
    res.setHeader('Cache-Control', 's-maxage=300');
    return res.json({ attachments });
  } catch (err) {
    console.error('Message API error:', err);
    return res.status(500).json({ error: 'Failed to fetch message' });
  }
}
