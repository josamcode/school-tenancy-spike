import { formatAmount } from '../lib/format';

// The number first and the currency code after it, in both languages.
export function Money({
  amount,
  currency,
}: {
  amount: string;
  currency: string;
}) {
  return (
    <bdi dir="ltr" className="number" data-testid="money">
      <span data-testid="money-value">{formatAmount(amount)}</span>{' '}
      <span data-testid="money-currency">{currency}</span>
    </bdi>
  );
}
