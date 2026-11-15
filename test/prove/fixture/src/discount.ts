// A stand-in for a protected rule: a discount is never more than the amount.
export function discounted(amount: number, discount: number): number {
  if (discount > amount) {
    throw new Error('A discount cannot exceed the amount');
  }
  return amount - discount;
}

export function label(amount: number): string {
  return `${amount.toFixed(2)} AED`;
}
