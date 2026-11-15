import { signWebhook } from './webhook-signature.js';

describe('webhook signature', () => {
  // The expected value was computed with openssl, not with this code:
  // HMAC-SHA256 over "id.timestamp.body", keyed with the bytes the secret
  // encodes after its whsec_ prefix.
  const message = {
    secret: 'whsec_dGVzdC1vbmx5LXdlYmhvb2sta2V5LTAxMjM0NTY3ODk=',
    id: 'e5000000-0000-4000-8000-00000000aaaa',
    timestamp: 1767216600,
    body: '{"id":"e5000000-0000-4000-8000-00000000aaaa","n":1}',
  };

  it('matches a signature computed outside this code', () => {
    expect(signWebhook(message)).toBe(
      'v1,O3AvswB1SbbjPgIB7f9vDB42yRrBtbwC0SjBugZALHc=',
    );
  });

  it.each([
    ['the id', { id: 'e5000000-0000-4000-8000-00000000aaab' }],
    ['the timestamp', { timestamp: 1767216601 }],
    [
      'the body',
      { body: '{"id":"e5000000-0000-4000-8000-00000000aaaa","n":2}' },
    ],
    [
      'the secret',
      { secret: 'whsec_b3RoZXIta2V5LW90aGVyLWtleS1vdGhlci1rZXk=' },
    ],
  ])('changes when %s changes', (_what, change) => {
    expect(signWebhook({ ...message, ...change })).not.toBe(
      signWebhook(message),
    );
  });
});
