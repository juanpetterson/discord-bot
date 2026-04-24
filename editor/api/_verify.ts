import { createHmac } from 'crypto';

export function verifySignature(
  channelId: string,
  messageId: string,
  signature: string | undefined
): boolean {
  const secret = process.env.CLIP_EDITOR_SECRET;
  if (!secret) return true; // No secret configured = skip validation

  if (!signature) return false;

  const expected = createHmac('sha256', secret)
    .update(`${channelId}:${messageId}`)
    .digest('hex')
    .slice(0, 16);

  return signature === expected;
}
