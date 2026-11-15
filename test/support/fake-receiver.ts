import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import http from 'node:http';
import { AddressInfo } from 'node:net';

export type Verdict =
  | 'accepted'
  | 'duplicate'
  | 'bad_signature'
  | 'stale'
  | 'failed_on_purpose'
  | 'hung';

export interface Received {
  id: string;
  timestamp: string;
  signature: string;
  contentType: string;
  body: string;
  receivedAt: number;
  signatureValid: boolean;
  verdict: Verdict;
}

const TOLERANCE_SECONDS = 300;

export const newSecret = () => `whsec_${randomBytes(24).toString('base64')}`;

// Written separately from the sender's signing code on purpose.
export function expectedSignature(
  secret: string,
  id: string,
  timestamp: string,
  body: string,
): string {
  const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
  const mac = createHmac('sha256', key)
    .update(`${id}.${timestamp}.${body}`)
    .digest('base64');
  return `v1,${mac}`;
}

export function signatureMatches(
  secret: string,
  message: { id: string; timestamp: string; signature: string; body: string },
): boolean {
  const expected = Buffer.from(
    expectedSignature(secret, message.id, message.timestamp, message.body),
  );
  return message.signature.split(' ').some((candidate) => {
    const given = Buffer.from(candidate);
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
}

// Stands in for a school's own system. It verifies every request the way a
// real receiver should, can be told to fail or to hang, and records everything.
export class FakeReceiver {
  readonly requests: Received[] = [];
  url = '';
  private readonly processed = new Set<string>();
  private readonly held = new Set<http.ServerResponse>();
  private failures = 0;
  private hanging = false;
  private server?: http.Server;

  constructor(readonly secret: string = newSecret()) {}

  get accepted(): Received[] {
    return this.requests.filter((request) => request.verdict === 'accepted');
  }

  // Requests that were received and are still waiting for an answer.
  get open(): number {
    return this.held.size;
  }

  failNext(count: number): void {
    this.failures = count;
  }

  alwaysFail(): void {
    this.failures = Infinity;
  }

  // Receives requests and never answers them.
  hang(): void {
    this.hanging = true;
  }

  async start(): Promise<string> {
    this.server = http.createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on('data', (chunk: Buffer) => chunks.push(chunk));
      request.on('end', () =>
        this.answer(request, Buffer.concat(chunks).toString('utf8'), response),
      );
    });
    await new Promise<void>((resolve) =>
      this.server!.listen(0, '127.0.0.1', resolve),
    );
    const { port } = this.server.address() as AddressInfo;
    this.url = `http://127.0.0.1:${port}/hooks`;
    return this.url;
  }

  async stop(): Promise<void> {
    if (!this.server) return;
    this.server.closeAllConnections();
    await new Promise((resolve) => this.server!.close(resolve));
  }

  private answer(
    request: http.IncomingMessage,
    body: string,
    response: http.ServerResponse,
  ): void {
    const header = (name: string) => String(request.headers[name] ?? '');
    const message = {
      id: header('webhook-id'),
      timestamp: header('webhook-timestamp'),
      signature: header('webhook-signature'),
      contentType: header('content-type'),
      body,
      receivedAt: Date.now(),
    };
    const signatureValid = signatureMatches(this.secret, message);
    const record = (verdict: Verdict, status: number) => {
      this.requests.push({ ...message, signatureValid, verdict });
      if (verdict === 'hung') {
        this.held.add(response);
        response.on('close', () => this.held.delete(response));
        return;
      }
      response.writeHead(status, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ verdict }));
    };

    if (this.hanging) return record('hung', 0);
    if (this.failures > 0) {
      this.failures -= 1;
      return record('failed_on_purpose', 500);
    }
    if (!signatureValid) return record('bad_signature', 401);
    const age = Math.abs(Date.now() / 1000 - Number(message.timestamp));
    if (!(age <= TOLERANCE_SECONDS)) return record('stale', 400);
    if (this.processed.has(message.id)) return record('duplicate', 200);
    this.processed.add(message.id);
    return record('accepted', 200);
  }
}
