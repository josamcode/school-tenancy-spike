import { createHmac, timingSafeEqual } from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

// A fake webhook receiver, for development only. It stands in for a school's
// own system: it checks every request the way a real receiver should, keeps
// what it saw in memory, and tells anyone on this machine who asks.

// Must match the endpoint db/seed.ts gives the demo school with a webhook.
// The secret is a local development value. A test compares the two.
export const RECEIVER_PORT = 3300;
export const RECEIVER_SECRET =
  'whsec_ZGV2X29ubHlfZGVtb19yZWNlaXZlcl9zZWNyZXQhIQ==';

const TOLERANCE_SECONDS = 300;
const MAX_BODY_BYTES = 1_000_000;
const MAX_EVENTS = 1000;

export type Verdict = 'accepted' | 'duplicate' | 'bad_signature' | 'stale';

export interface ReceiverRecord {
  id: string;
  receivedAt: string;
  signatureValid: boolean;
  verdict: Verdict;
}

export interface Receiver {
  url: string;
  port: number;
  address: string;
  stop: () => Promise<void>;
}

// Standard Webhooks: HMAC-SHA256 over "id.timestamp.body", keyed with the
// bytes the secret encodes after whsec_. Written apart from the sender's
// signing code on purpose.
function signatureValid(
  secret: string,
  message: { id: string; timestamp: string; signature: string; body: string },
): boolean {
  const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
  const expected = Buffer.from(
    `v1,${createHmac('sha256', key)
      .update(`${message.id}.${message.timestamp}.${message.body}`)
      .digest('base64')}`,
  );
  // The header may carry several signatures, separated by spaces.
  return message.signature.split(' ').some((candidate) => {
    const given = Buffer.from(candidate);
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
}

export async function startReceiver(
  options: { port?: number; secret?: string } = {},
): Promise<Receiver> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('The fake webhook receiver is for development only');
  }
  const secret = options.secret ?? RECEIVER_SECRET;
  const records = new Map<string, ReceiverRecord[]>();

  const judge = (request: http.IncomingMessage, body: string) => {
    const header = (name: string) => String(request.headers[name] ?? '');
    const id = header('webhook-id');
    const timestamp = header('webhook-timestamp');
    const valid = signatureValid(secret, {
      id,
      timestamp,
      signature: header('webhook-signature'),
      body,
    });
    const age = Math.abs(Date.now() / 1000 - Number(timestamp));
    const verdict: Verdict = !valid
      ? 'bad_signature'
      : !(age <= TOLERANCE_SECONDS)
        ? 'stale'
        : records.get(id)?.some((record) => record.verdict === 'accepted')
          ? 'duplicate'
          : 'accepted';

    if (!records.has(id) && records.size >= MAX_EVENTS) {
      records.delete(records.keys().next().value!);
    }
    records.set(id, [
      ...(records.get(id) ?? []),
      {
        id,
        receivedAt: new Date().toISOString(),
        signatureValid: valid,
        verdict,
      },
    ]);
    console.log(
      `Webhook ${id || '(no id)'}: ${verdict}, signature ${valid ? 'valid' : 'not valid'}`,
    );
    return verdict;
  };

  const server = http.createServer((request, response) => {
    const answer = (status: number, body: unknown) => {
      response.writeHead(status, { 'content-type': 'application/json' });
      response.end(JSON.stringify(body));
    };
    const { pathname } = new URL(request.url ?? '/', 'http://receiver');

    if (request.method === 'POST' && pathname === '/hooks') {
      const chunks: Buffer[] = [];
      let size = 0;
      request.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > MAX_BODY_BYTES) request.destroy();
        else chunks.push(chunk);
      });
      request.on('end', () => {
        const verdict = judge(request, Buffer.concat(chunks).toString('utf8'));
        answer(
          verdict === 'bad_signature' ? 401 : verdict === 'stale' ? 400 : 200,
          { verdict },
        );
      });
      return;
    }

    // What was received for one event, oldest first.
    const asked = /^\/received\/([^/]+)$/.exec(pathname);
    if (request.method === 'GET' && asked) {
      answer(200, records.get(decodeURIComponent(asked[1])) ?? []);
      return;
    }
    answer(404, { message: 'Not found' });
  });

  // This machine only: nothing else should be able to reach a fake.
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port ?? RECEIVER_PORT, '127.0.0.1', resolve);
  });
  const { port, address } = server.address() as AddressInfo;
  return {
    url: `http://${address}:${port}`,
    port,
    address,
    stop: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

if (import.meta.main) {
  const receiver = await startReceiver({
    port: Number(process.env.RECEIVER_PORT ?? RECEIVER_PORT),
  });
  console.log(`Fake webhook receiver, development only: ${receiver.url}/hooks`);
}
