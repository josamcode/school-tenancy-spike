import { createHmac } from 'node:crypto';

export interface SignedMessage {
  secret: string;
  id: string;
  // Unix seconds.
  timestamp: number;
  body: string;
}

// The Standard Webhooks scheme: HMAC-SHA256 over "id.timestamp.body", keyed
// with the bytes the secret encodes after its whsec_ prefix. The receiver
// checks it against the exact bytes it received.
export function signWebhook(message: SignedMessage): string {
  const key = Buffer.from(message.secret.replace(/^whsec_/, ''), 'base64');
  const mac = createHmac('sha256', key)
    .update(`${message.id}.${message.timestamp}.${message.body}`)
    .digest('base64');
  return `v1,${mac}`;
}
