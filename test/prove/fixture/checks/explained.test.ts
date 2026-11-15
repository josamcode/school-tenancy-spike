import { describe, it } from 'vitest';
import { discounted } from '../src/discount.js';

// Fails with a message of several lines, as a browser assertion does.
describe('a discount that is too large', () => {
  it('is refused, and the refusal is explained', () => {
    let given = 'nothing';
    try {
      given = String(discounted(100, 130));
    } catch {
      return;
    }
    throw new Error(
      [
        'The discount was not refused.',
        'Amount: 100',
        'Discount: 130',
        `It gave: ${given}`,
      ].join('\n'),
    );
  });
});
