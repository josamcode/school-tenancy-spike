# 9. Invoices: number and issue date decided by the database, and no back-dating by the application

## Context

An invoice number must be unique and unbroken within a school, and its issue
date is a legal fact. Two requests at the same moment must not get the same
number, a rolled-back request must not leave a gap, and nobody using the
application may issue an invoice dated last month.

## Decision

- **A trigger assigns the number and the issue date on insert, whoever
  inserts** (`db/migrations/0012_calendar_guarantees.sql`).
- **The number is the school's highest plus one, read under an advisory
  lock** that every insert in that school takes. Two inserts cannot read the
  same highest number, and a rollback leaves no gap. Numbers are counted per
  school, never reset, and shown as `INV-000042`.
- **The instant is the clock when the trigger runs, after the lock,** not the
  transaction's start. With the transaction start, an insert that waited for
  the lock could get a higher number and an earlier instant.
- **The issue date is that instant in the school's timezone.** It is derived,
  whatever the writer supplies.
- **The application cannot name these columns.** The runtime role's `INSERT`
  on `invoices` is granted by column and leaves out `number`, `issued_at` and
  `issue_date`. An attempt is refused by PostgreSQL as a missing privilege.
- **Only the owner role may supply `issued_at`,** for an import of invoices
  that already exist. The number and the issue date are still assigned.
- **None of the three can change afterwards,** for any role.
- **The due date cannot be before the issue date.**

## Alternatives considered

- **A sequence.** It is fast and it leaves a gap on every rollback, and one
  sequence per school would have to be created with each school.
- **A counter table.** It works, with a row to lock. It needs an `UPDATE`
  privilege for the runtime role and a row per school before the first
  invoice. The advisory lock needs neither, and the ledger and the event
  routing already use the same kind of lock.
- **Assigning the number in the service.** Any other writer would have to
  repeat it, and the lock would be the service's to forget.
- **Letting the application pass a date and validating it.** A rule such as
  "not more than a day in the past" is a back-dating window with a width.
  Taking the clock leaves no window.
- **The transaction's start time as the instant.** See above: numbers and
  instants could then disagree about the order of two invoices.

## Consequences

- Within a school, invoice numbers follow the order of their instants.
- Inserts of invoices in one school run one at a time for the moment the
  trigger holds the lock. Other schools do not wait.
- An import must run as the owner.

## Known limits

- An owner import keeps the real instant and gets a new number from our
  sequence. Imported invoices should keep their original number in a column
  of their own; that is not built.
- The advisory lock key is a hash of the school id. A collision would cause a
  needless wait.
- An invoice has one description and one amount. There are no lines.
- An amount with more decimals than its currency has makes the invoice route
  answer 500. Nothing tests that.

## Evidence

- Pull request: [#7](https://github.com/josamcode/school-tenancy-spike/pull/7).
- What the database decides about an invoice, as the runtime role and as the
  owner: `test/db/invoice-rules.spec.ts`.
- Two inserts at once, twenty at once, a rollback, and two schools:
  `test/finance/invoice-number-concurrency.spec.ts`.
- What the route returns: `test/api/invoice.e2e-spec.ts`.
- `pnpm prove` rows: `invoices.no-numbering-lock`,
  `invoices.runtime-issued-at`.
