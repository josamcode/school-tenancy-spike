import { describe, expect, it } from 'vitest';

// Fails with no patch at all, so the runner can be shown a red baseline.
describe('a check that is already red', () => {
  it('fails before any patch', () => {
    expect(1).toBe(2);
  });
});
