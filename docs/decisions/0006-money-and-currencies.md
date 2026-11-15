# 6. Money and currencies: signed decimal amounts, one currency per account, FX positions and revaluation as of a date

## Context

Schools in the Gulf invoice in one currency and are sometimes paid in
another. Dirhams and riyals have two decimals; Bahraini, Kuwaiti and Omani
dinars have three. A ledger that mixes currencies in one account, rounds in
floating point, or recognises exchange differences by accident produces
figures nobody can reconcile.

## Decision

- **Amounts are decimal strings outside and `BigInt` minor units inside**
  (`src/finance/money.ts`). Nothing uses floating point, and no library was
  added. The database stores `numeric`.
- **A line has one signed amount.** Positive is a debit, negative a credit,
  zero is refused. The balance rule is a sum, a reversal is the same lines
  negated, and "both debit and credit filled in" cannot be stored.
- **An account has exactly one currency,** enforced by a composite foreign key
  from the line. A balance is never a mix.
- **Currencies are a catalog with their minor units.** A trigger refuses a
  line with more decimals than its currency has. It is the backstop for a
  rounding bug in the application.
- **Rounding is half away from zero,** the commercial rule and what
  PostgreSQL's `round` does. A split hands the remainder out one minor unit at
  a time from the first part, so 1,000.00 in three is 333.34, 333.33, 333.33
  and no difference is created.
- **One FX position per foreign currency.** A position has an account in that
  currency and an account in the base currency, neither shared with another
  currency, and a gain or loss account that may be shared. Every conversion
  goes through the position of its currency, so each currency balances by
  itself.
- **Revaluation is one operation.** It sets the base side of a position to
  what the foreign side is worth: target = −(foreign-side balance) × rate,
  rounded to the base currency's minor units. The difference goes to FX gain
  or loss. Closing a position is the same operation with a foreign balance of
  zero. No difference posts nothing.
- **Monetary balances are revalued at the closing rate at period end,** and
  the difference is recognised in that period. This follows IAS 21,
  paragraphs 23 and 28.
- **Both balances are read as of the revaluation date.** December is closed
  in January, after January payments are posted. A revaluation dated 31
  December must not count January's lines.
- **Revaluation and conversion take an advisory lock per school and
  currency.** Revaluation takes it exclusively and conversion takes it shared,
  before any balance is read, so two revaluations cannot both book the same
  difference.
- **Rates are per school.** A conversion uses the latest rate on or before
  its date and is refused when there is none. The rate is copied onto the
  entry, so a later change to the rate table cannot alter history.

## Alternatives considered

- **Floating point.** 0.1 + 0.2 is not 0.3, and a ledger must sum to exactly
  zero.
- **A decimal library.** `BigInt` and the database's `numeric` cover what the
  ledger needs: add, negate, multiply by a rate and round once.
- **Separate debit and credit columns.** It is how a printed journal looks.
  It also allows a line with both, or neither, and makes the balance rule two
  sums.
- **One clearing account in the base currency for all foreign currencies,
  with gain or loss recognised when it returns to zero.** This was our first
  design, and it fails twice. A school that keeps a foreign balance never
  records its gain or loss. And when one currency closes, the residue of the
  shared account includes another currency's cost.
- **Gain or loss only when money is converted back.** An open foreign balance
  would be carried at an old rate for as long as it stays open.
- **A rounding account.** With the remainder handed out in the split, and
  conversion differences left in the position until revaluation, nothing is
  left to put in one.
- **A row lock on the position.** The runtime role has no `UPDATE` on
  `fx_positions`, so it cannot lock its rows. An advisory lock needs no
  privilege.

## Consequences

- The sum of all lines is zero in each currency, at any moment.
- The foreign-side balances are what is actually held in each currency.
- A revaluation can be run again for the same date and posts nothing.
- A new currency is one row in the catalog, one entry in the code list, and a
  position per school that uses it.

## Known limits

- The database does not check that the two amounts of a conversion agree with
  the rate on the entry. The service computes them and tests assert them.
- The advisory lock key is a hash of the school and the currency. A collision
  would cause a needless wait, never a wrong figure.
- A conversion dated before an existing revaluation is not included in it.
  The next revaluation picks up the difference, but the earlier period's
  figure stays as booked. Locking the period prevents this.
- Period-end revaluation is an operation someone calls. Nothing runs it on a
  schedule.
- The currency list in code and the `currencies` table are kept equal by a
  test.

## Evidence

- Pull request: [#5](https://github.com/josamcode/school-tenancy-spike/pull/5).
- Parsing, rounding and splitting: `src/finance/money.spec.ts`.
- Positions, revaluation up and down, closing one position without touching
  another, and the sub-ledger in two currencies:
  `test/finance/fx-positions.spec.ts`.
- Revaluation as of its date: `test/finance/fx-revaluation-date.spec.ts`.
- The position lock: `test/finance/ledger-concurrency.spec.ts`.
- Decimals per currency and one currency per account:
  `test/finance/ledger-guarantees.spec.ts`, `test/db/currency-list.spec.ts`.
- The whole scenario: `test/finance/ledger-scenario.spec.ts`.
- `pnpm prove` rows: `ledger.revalue-all-dates`, `ledger.no-position-lock`.
