# 5. Ledger guarantees enforced by the database: balance, append-only and the period lock

## Context

A ledger is trusted because three things are always true: every entry
balances, what is posted is never changed, and a closed period stays closed.
If these live in a service, each new code path, script or import has to
remember them, and one bug writes a wrong figure that looks right.

## Decision

The three guarantees are enforced by PostgreSQL, for every role, the owner
included (`db/migrations/0006_ledger_guarantees.sql`). The service decides
what to post. The database decides whether it may be posted.

- **Balance.** Deferred constraint triggers on entries and lines check, when
  the transaction commits, that the entry has at least two lines and sums to
  zero in each currency. If the check sees fewer than two lines it fails, so
  it fails closed.
- **Append-only.** The runtime role has no `UPDATE`, `DELETE` or `TRUNCATE` on
  entries and lines, and triggers refuse all three for every role. A line can
  be inserted only in the transaction that posts its entry, so nothing is
  added to an old entry.
- **Period lock.** The trigger on a new entry takes a share lock on the
  period's row, then requires the period to be open and the date to be inside
  it. A posting and a lock of the period therefore wait for each other. A
  period only goes from open to locked.
- **A correction is a reversal:** a new entry with the same lines negated and
  a link to the original, posted in an open period.
- **A posted invoice cannot change.** A trigger refuses an update or delete
  once an entry refers to the invoice, and a partial unique index allows one
  invoice entry per invoice. Posting reads the invoice `FOR SHARE`, so an edit
  made during the posting waits and is then refused.
- **Periods lie inside their year and cannot overlap,** by an exclusion
  constraint. A date belongs to at most one period.
- **The base currency is set once** by the owner and refused any change.
- **The student sub-ledger is derived.** It is a query over the lines on
  control accounts, per student and currency, and is never stored. A trigger
  requires a student on every control-account line and refuses one elsewhere.

## Alternatives considered

- **The same rules in the service only.** They would hold for the code paths
  that call the service. An import script, a migration or a later module
  would bypass them without an error.
- **A balance check when each line is inserted.** An entry is unbalanced until
  its last line is in, so the check must wait for the commit. A deferred
  constraint trigger is the database's way to say that.
- **Editing an entry and keeping an audit trail.** The books would then depend
  on the trail being complete. With reversals the books are the trail.
- **A period check in the application.** It reads the period's status and
  then posts. A lock that commits between the two lets an entry into a closed
  period. The share lock in the trigger closes that gap.
- **Reopening a locked period.** It is sometimes wanted. It also makes every
  reported figure provisional. A correction is posted in an open period
  instead.
- **A stored balance per student.** It must be kept equal to the lines by
  every writer. A query cannot disagree with the lines.

## Consequences

- A bug in the service cannot unbalance an entry, alter a posted line or post
  into a locked period. The transaction fails instead.
- An error surfaces at commit, not at the statement that caused it.
- A balance used for a date is the balance as of that date, and a value read
  to decide a write is read under a lock that the conflicting writer also
  takes (see [decision 6](0006-money-and-currencies.md)).

## Known limits

- The owner role owns the tables, so a migration can disable or drop a
  trigger. The database cannot bind its own table owner against DDL.
- The only ledger route reads. Postings are made by the service in tests, by
  the seed, and by the registration fee handler.
- The steps of the scenario test depend on each other, so one failure there
  cascades to the steps after it.
- A posting dated before an existing revaluation is not included in it.
  Locking the period is what prevents that.

## Evidence

- Pull request: [#5](https://github.com/josamcode/school-tenancy-spike/pull/5).
- Each guarantee, as the runtime role and as the owner:
  `test/finance/ledger-guarantees.spec.ts`.
- Locks that must make two transactions wait for each other:
  `test/finance/ledger-concurrency.spec.ts`.
- A scenario with an invoice, a discount, a late fee, a refund and two
  foreign currencies that sums to zero in every currency:
  `test/finance/ledger-scenario.spec.ts`.
- The read route and the screen: `test/api/ledger-read.e2e-spec.ts`,
  `web/e2e/ledger.spec.ts`.
- `pnpm prove` rows: `ledger.no-balance-check`, `ledger.not-append-only`,
  `ledger.locked-period-open`, `ledger.period-no-row-lock`,
  `ledger.invoice-no-share-lock`.
