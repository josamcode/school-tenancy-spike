import { describe, expect, it } from 'vitest';
import { discounted } from '../src/discount.js';

// The second check uses what the first one left, as steps of a scenario do.
describe('a discount in two steps', () => {
  let left: number;

  it('takes the first discount', () => {
    left = discounted(100, 30);
    expect(left).toBe(70);
  });

  it('refuses a second discount that exceeds what is left', () => {
    expect(() => discounted(left, 80)).toThrow('cannot exceed the amount');
  });
});
