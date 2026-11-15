import { randomUUID } from 'node:crypto';
import { demoReceiver } from '../../db/seed.js';
import {
  Receiver,
  RECEIVER_PORT,
  RECEIVER_SECRET,
  startReceiver,
} from '../../dev/receiver.js';
import { signWebhook } from '../../src/events/webhook-signature.js';

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

// The receiver that `pnpm dev` starts. It stands in for a school's own
// system, in development only.
describe('the development webhook receiver', () => {
  let receiver: Receiver;

  const now = () => Math.floor(Date.now() / 1000);
  const body = (id: string) =>
    JSON.stringify({ id, type: 'student.accepted', data: { name: 'سالم' } });

  // Sends what the worker sends: the same headers, signed by its own code.
  const send = (
    id: string,
    options: { secret?: string; timestamp?: number; sent?: string } = {},
  ) => {
    const timestamp = options.timestamp ?? now();
    const signed = body(id);
    return fetch(`${receiver.url}/hooks`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'webhook-id': id,
        'webhook-timestamp': String(timestamp),
        'webhook-signature': signWebhook({
          secret: options.secret ?? RECEIVER_SECRET,
          id,
          timestamp,
          body: signed,
        }),
      },
      body: options.sent ?? signed,
    });
  };
  const recorded = async (id: string) =>
    (await fetch(`${receiver.url}/received/${id}`)).json();

  beforeAll(async () => {
    receiver = await startReceiver({ port: 0 });
  });

  afterAll(async () => {
    await receiver?.stop();
  });

  it('has the port and the secret the seed gives the demo school’s endpoint', () => {
    expect(demoReceiver.url).toBe(`http://127.0.0.1:${RECEIVER_PORT}/hooks`);
    expect(demoReceiver.port).toBe(RECEIVER_PORT);
    expect(demoReceiver.secret).toBe(RECEIVER_SECRET);
  });

  it('listens on this machine only', () => {
    expect(receiver.address).toBe('127.0.0.1');
    expect(receiver.url).toBe(`http://127.0.0.1:${receiver.port}`);
  });

  it('accepts a request signed the way the worker signs it, and records that the signature was valid', async () => {
    const id = randomUUID();
    const response = await send(id);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ verdict: 'accepted' });

    expect(await recorded(id)).toEqual([
      {
        id,
        receivedAt: expect.stringMatching(ISO),
        signatureValid: true,
        verdict: 'accepted',
      },
    ]);
  });

  it('refuses a body that was changed after it was signed', async () => {
    const id = randomUUID();
    const response = await send(id, {
      sent: body(id).replace('student.accepted', 'student.rejected'),
    });
    expect(response.status).toBe(401);
    expect(await recorded(id)).toMatchObject([
      { signatureValid: false, verdict: 'bad_signature' },
    ]);
  });

  it('refuses a request signed with another secret', async () => {
    const id = randomUUID();
    const other = `whsec_${Buffer.from('another secret, 24 bytes').toString('base64')}`;
    const response = await send(id, { secret: other });
    expect(response.status).toBe(401);
    expect(await recorded(id)).toMatchObject([
      { signatureValid: false, verdict: 'bad_signature' },
    ]);
  });

  it('refuses a correctly signed request that is ten minutes old', async () => {
    const id = randomUUID();
    const response = await send(id, { timestamp: now() - 600 });
    expect(response.status).toBe(400);
    expect(await recorded(id)).toMatchObject([
      { signatureValid: true, verdict: 'stale' },
    ]);
  });

  it('answers a repeat of the same event with 200 and marks it a duplicate', async () => {
    const id = randomUUID();
    expect((await send(id)).status).toBe(200);
    const repeat = await send(id);
    expect(repeat.status).toBe(200);
    expect(
      (await recorded(id)).map((record: { verdict: string }) => record.verdict),
    ).toEqual(['accepted', 'duplicate']);
  });

  it('has recorded nothing for an event it never received', async () => {
    expect(await recorded(randomUUID())).toEqual([]);
  });

  it('answers 404 to anything else', async () => {
    expect((await fetch(`${receiver.url}/`)).status).toBe(404);
    expect((await fetch(`${receiver.url}/hooks`)).status).toBe(404);
    expect(
      (await fetch(`${receiver.url}/received`, { method: 'POST' })).status,
    ).toBe(404);
  });

  it('refuses to start in production', async () => {
    const before = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      await expect(startReceiver({ port: 0 })).rejects.toThrow(
        'development only',
      );
    } finally {
      process.env.NODE_ENV = before;
    }
  });
});
