# school-tenancy-spike

A technical spike for a multi-tenant school platform. It takes the
assumptions that would be most expensive to get wrong, builds the smallest
thing that tests each one, and proves it with tests against a real
PostgreSQL. Then it breaks each protection on purpose and checks that the
tests notice.

It is short-lived code, not a product.

## What it proves

Each proof is a claim, the tests that hold it, a screen that shows it, and
the sabotages that its tests must catch. The [proof map](#proof-map) has the
details.

- **Isolation.** One school cannot read or write another school's rows: not
  through a query that forgets its school filter, not through a pooled
  connection, and not through a school id the client supplies. PostgreSQL
  enforces it with forced row-level security, and one function is the only
  code that says which school a transaction is for.
  [Decision 1](docs/decisions/0001-tenant-isolation-in-the-database.md).
- **Reach.** Everything the application's database role can touch is an
  ordinary table with row-level security enabled, forced, and a policy. The
  rule is read from the catalog, so a new table is covered without being
  named. Work that crosses schools has a narrow role of its own.
  [Decision 2](docs/decisions/0002-the-reach-rule-and-roles.md).
- **Secure by default.** A new route needs a token, runs inside the school's
  transaction and must declare a permission, or the application does not
  start. Refusals come in one fixed order and tell a stranger nothing about a
  school. [Decision 3](docs/decisions/0003-secure-by-default.md).
- **Modules and permissions.** A module is off for a school unless a row says
  it is on, and the rest keeps working. One login works across schools. A
  permission is held through a role in that school or a grant in that school,
  and a group gives no access by itself.
  [Decision 4](docs/decisions/0004-modules-and-permissions.md).
- **Ledger and money.** Every entry balances in each currency, posted lines
  never change, and nothing posts into a locked period. The database enforces
  all three for every role. Foreign currency goes through one position per
  currency and is revalued as of a date. A scenario with an invoice, a
  discount, a late fee, a correction, a refund and two foreign currencies
  sums to zero in every currency.
  [Decision 5](docs/decisions/0005-ledger-guarantees-in-the-database.md),
  [decision 6](docs/decisions/0006-money-and-currencies.md).
- **Events and delivery.** Accepting a student writes an event in the same
  transaction. A worker delivers it exactly once in effect: to finance, which
  posts a fee, or to the school's own system as a signed webhook. A failure
  is recorded in the school's own tables.
  [Decision 7](docs/decisions/0007-events.md),
  [decision 8](docs/decisions/0008-delivery.md).
- **Invoices.** The database assigns an invoice's number and issue date. Two
  inserts at once get two numbers, a rollback leaves no gap, and the
  application cannot back-date.
  [Decision 9](docs/decisions/0009-invoice-numbers-and-dates.md).
- **Arabic, RTL and Hijri.** One invoice template renders right to left in
  Arabic and left to right in English, on the screen and as a PDF, with mixed
  names in order and Western digits. Each date is shown in both calendars. A
  country's official month start beats the calculated one, and a Hijri date
  that cannot be worked out does not stop the invoice.
  [Decision 10](docs/decisions/0010-arabic-rtl-and-hijri.md).
- **The web app.** Each proof has a screen that reads the API as the signed-in
  user and shows the server's answer beside itself. The screens add no rule
  of their own. [Decision 11](docs/decisions/0011-the-web-app.md).

How the proofs themselves are checked is
[decision 12](docs/decisions/0012-how-the-proofs-are-kept-honest.md). The
tables, their keys, the roles that reach them and their policies are in the
[data model](docs/data-model.md), which is generated from the schema.

## Requirements

- Node.js 24
- pnpm 11
- Docker

## Setup

```bash
pnpm install
pnpm --filter web exec playwright install chromium
cp .env.example .env
pnpm db:up
pnpm db:migrate
pnpm db:seed
```

The second command downloads the headless Chromium that prints invoices to
PDF and runs the browser tests. Nothing is downloaded at runtime.

`pnpm db:up` starts PostgreSQL 16 on `127.0.0.1:5440`. On first start it runs
`db/bootstrap/roles.sql`, which creates the four roles. The script runs only
when the data directory is empty.

`pnpm db:seed` adds the schools, users and data that the tests and the demo
use. The ids are in `db/seed.ts`.

The passwords in `db/bootstrap/roles.sql` and `docker-compose.yml`, and every
value in `.env.example` including `JWT_SECRET`, are local development values.
They protect nothing and must not be reused anywhere else.

## Run it

```bash
pnpm dev
```

It starts four processes:

| Process       | Where                   | What it is                                                       |
| ------------- | ----------------------- | ---------------------------------------------------------------- |
| API           | `http://localhost:3100` | `pnpm start:dev`                                                 |
| Web app       | `http://localhost:3200` | `pnpm start:web`; `/ar` is the Arabic app, `/en` the English one |
| Worker        | no port                 | `pnpm start:worker`; delivers events                             |
| Fake receiver | `http://127.0.0.1:3300` | `pnpm start:receiver`; stands in for a school's own system       |

Check that ports 3100, 3200 and 3300 are free first. If one script fails, all
four stop.

There is no identity provider. In development, `http://localhost:3200/ar/dev/sign-in`
signs you in as a seed user. That page is the demo guide.

The API alone:

```bash
pnpm start:dev
curl http://localhost:3100/health
```

Routes under `/schools/:schoolId` need a bearer token: an HS256 JWT signed
with `JWT_SECRET` that carries the user id as `sub` and an `exp`. To make one
for the seeded user of the first school:

```bash
node --env-file=.env -e "import('jose').then(async ({ SignJWT }) => console.log(await new SignJWT().setProtectedHeader({ alg: 'HS256' }).setSubject(process.argv[1]).setExpirationTime('1h').sign(new TextEncoder().encode(process.env.JWT_SECRET))))" a0000000-0000-4000-8000-0000000000a1
```

```bash
curl -H "Authorization: Bearer <token>" http://localhost:3100/schools/a0000000-0000-4000-8000-000000000001/students
```

The worker needs `DISPATCHER_DATABASE_URL` and `QUEUE_DATABASE_URL` as well as
`DATABASE_URL`. The API needs neither and is never given them.

### Reset the local database

Accepting an application in the demo uses it up, and the bootstrap script
runs only on an empty data directory. A reset brings everything back:

```bash
docker compose down -v
pnpm db:up
pnpm db:migrate
pnpm db:seed
```

## Demo walkthrough

Start `pnpm dev` and open `http://localhost:3200/ar/dev/sign-in`, or
`/en/dev/sign-in` for English. Every page has two parts: the screen a user
would see, and beside it the server response for each call the page made,
with allowed or refused in words, the status, and the raw request and body.

The guide has one group per proof. Each entry signs you in as a seed user and
lands on its page.

1. **The guide.** Six groups: tenant isolation, modules, permissions, the
   ledger, events, and invoices. Each row says what it shows first, then who
   you sign in as. It exists in development only.
   Test: `web/e2e/demo-guide.spec.ts`.
2. **Isolation: students.** You are the principal of four schools. The page
   lists your schools and the students of the one you are in. Switch school,
   and the list is that school's alone. The server response shows
   `GET /me/schools` and `GET /schools/:schoolId/students`, both allowed.
   Test: `web/e2e/isolation.spec.ts`.
3. **Isolation: a school that is not yours.** The field on the same page
   opens any school by its id, and it is filled with a school the principal
   has no access to. The screen shows nothing of that school, and the server
   response shows the plain 403. An id that names no school gets exactly the
   same answer. Test: `web/e2e/isolation.spec.ts`.
4. **Modules: finance on.** The school's own page makes one real call to each
   of the school's pages and shows what the server answered. In Al Yasmin all
   four are allowed. Test: `web/e2e/permissions.spec.ts`.
5. **Modules: finance off.** The same page in Al Rayhan, as the same user.
   Invoices and the ledger answer 403 `MODULE_DISABLED`; students still
   answer 200. Nothing on the page switches a module: that is the owner
   role's right, and the web server holds no owner credentials.
   Test: `web/e2e/permissions.spec.ts`.
6. **Permissions: three users, one school.** The same page in Al Yasmin as
   the school admin (everything allowed), as a staff member (students
   allowed, the rest 403 `PERMISSION_DENIED`), and as the group admin, who
   has no membership and one grant (what the grant names, and nothing else).
   Test: `web/e2e/permissions.spec.ts`.
7. **Permissions: a school of the group with no grant.** The group admin
   opens Al Rayhan, which is in their group. The server answers the plain
   403: a group gives no access. Test: `web/e2e/permissions.spec.ts`.
8. **The ledger.** Al Yasmin's books, read only: the total per currency,
   which is zero in each at that currency's decimals; what each student
   owes; the closed BHD position and the open SAR position with the FX gain;
   and the periods, with December 2025 locked. One call,
   `GET /schools/:schoolId/ledger`. As the staff member the same address
   answers `PERMISSION_DENIED` and shows no figure.
   Test: `web/e2e/ledger.spec.ts`.
9. **Events: to finance.** In Al Ghadeer, where finance is on, accept one of
   the six pending applications. The next page follows the acceptance: the
   event written, dispatched, routed to finance, and the registration fee of
   500.00 AED on the new student. The page asks the API again once a second
   until the outcome is known. Test: `web/e2e/events.spec.ts`.
10. **Events: to the school's own system.** In Al Murooj, where finance is
    off, accept an application. The page follows it to the webhook: routed to
    the webhook, each delivery attempt, and what the fake receiver recorded,
    including that the signature was valid. Tests: `web/e2e/events.spec.ts`,
    `web/e2e/demo-guide.spec.ts`.
11. **Invoices: the list.** Six entries, one per case: a Dubai invoice with
    an Arabic student name; the same instant in Riyadh, dated a day earlier;
    Muscat and Manama, where an official month start differs from the
    calculated one by a day, and Manama's amount is in dinars with three
    decimals; a staff member who is refused; and an invoice with no
    description, due date or country.
    Test: `web/e2e/invoice.spec.ts`.
12. **Invoices: the invoice.** Right to left in Arabic, left to right in
    English, with the same content. Each date is shown in both calendars. A
    name in the other script stays in order inside the sentence. The seed
    also has a Kuwait invoice whose Hijri date cannot be worked out, because
    an override there cannot be right: it shows its Gregorian date and says
    the Hijri date is unavailable. The invoice test opens it.
    Tests: `web/e2e/invoice.spec.ts`, `web/e2e/direction.spec.ts`.
13. **Invoices: the PDF.** The link on the invoice downloads the same
    document as one A4 page, with the bundled fonts embedded. The address
    answers as the API does: 401, 403 or 404 where the API refuses.
    Test: `web/e2e/pdf.spec.ts`.

## Proof map

| Proof                   | PR                                                                                                                             | Tests                                                                                                                                                                                                                                                                                                                      | Screen                                   | `pnpm prove` rows                                                                                                                                                                                               |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Isolation               | [#2](https://github.com/josamcode/school-tenancy-spike/pull/2)                                                                 | `test/db/isolation.spec.ts`, `test/db/constraints.spec.ts`, `test/db/tenant-db.spec.ts`, `test/db/tenant-db-failed-rollback.spec.ts`, `test/db/user-scope.spec.ts`, `test/api/students.e2e-spec.ts`                                                                                                                        | Students, steps 2 and 3                  | `isolation.force-rls`, `isolation.loose-policy`, `isolation.no-membership-check`, `isolation.single-column-fk`                                                                                                  |
| Reach                   | [#2](https://github.com/josamcode/school-tenancy-spike/pull/2), [#6](https://github.com/josamcode/school-tenancy-spike/pull/6) | `test/db/reach.spec.ts`, `test/db/role.spec.ts`, `test/db/event-roles.spec.ts`                                                                                                                                                                                                                                             | none: it is a property of the database   | `reach.table-without-rls`, `reach.other-schema`                                                                                                                                                                 |
| Secure by default       | [#2](https://github.com/josamcode/school-tenancy-spike/pull/2), [#3](https://github.com/josamcode/school-tenancy-spike/pull/3) | `test/api/secure-by-default.e2e-spec.ts`, `test/api/route-declarations.e2e-spec.ts`                                                                                                                                                                                                                                        | The server response on every page        | `auth.guard-not-global`, `modules.undeclared-route`                                                                                                                                                             |
| Modules and permissions | [#3](https://github.com/josamcode/school-tenancy-spike/pull/3), [#4](https://github.com/josamcode/school-tenancy-spike/pull/4) | `test/api/entitlements.e2e-spec.ts`, `test/api/access.e2e-spec.ts`, `test/db/modules.spec.ts`, `test/db/access.spec.ts`                                                                                                                                                                                                    | The school's own page, steps 4 to 7      | `modules.no-module-check`, `permissions.role-any-school`, `permissions.grant-any-school`                                                                                                                        |
| Ledger and money        | [#5](https://github.com/josamcode/school-tenancy-spike/pull/5)                                                                 | `test/finance/ledger-guarantees.spec.ts`, `test/finance/ledger-concurrency.spec.ts`, `test/finance/ledger-scenario.spec.ts`, `test/finance/fx-positions.spec.ts`, `test/finance/fx-revaluation-date.spec.ts`, `src/finance/money.spec.ts`, `test/api/ledger-read.e2e-spec.ts`                                              | The ledger, step 8                       | `ledger.no-balance-check`, `ledger.not-append-only`, `ledger.locked-period-open`, `ledger.period-no-row-lock`, `ledger.revalue-all-dates`, `ledger.no-position-lock`, `ledger.invoice-no-share-lock`            |
| Events and delivery     | [#6](https://github.com/josamcode/school-tenancy-spike/pull/6)                                                                 | `test/admissions/accept-transaction.spec.ts`, `test/api/admissions.e2e-spec.ts`, `test/events/dispatch.e2e-spec.ts`, `test/events/isolation.spec.ts`, `test/events/routing.spec.ts`, `test/events/idempotency.spec.ts`, `test/events/webhook.spec.ts`, `test/events/failed-events.spec.ts`, `test/events/fee-date.spec.ts` | Admissions, steps 9 and 10               | `events.event-own-transaction`, `events.accept-no-row-lock`, `events.no-processed-check`, `events.route-without-module-lock`, `events.no-delivery-resend`, `events.no-dead-letter`, `events.unsigned-timestamp` |
| Invoices                | [#7](https://github.com/josamcode/school-tenancy-spike/pull/7)                                                                 | `test/db/invoice-rules.spec.ts`, `test/finance/invoice-number-concurrency.spec.ts`, `test/api/invoice.e2e-spec.ts`                                                                                                                                                                                                         | Invoices, steps 11 and 12                | `invoices.no-numbering-lock`, `invoices.runtime-issued-at`                                                                                                                                                      |
| Arabic, RTL and Hijri   | [#7](https://github.com/josamcode/school-tenancy-spike/pull/7)                                                                 | `src/calendar/hijri.spec.ts`, `test/calendar/hijri-calendar.spec.ts`, `web/e2e/direction.spec.ts`, `web/e2e/invoice.spec.ts`, `web/e2e/pdf.spec.ts`, `web/test/logical-css.spec.ts`                                                                                                                                        | The invoice and its PDF, steps 12 and 13 | `calendar.override-ignored`, `web.no-bundled-fonts`                                                                                                                                                             |
| The web app             | [#7](https://github.com/josamcode/school-tenancy-spike/pull/7), [#8](https://github.com/josamcode/school-tenancy-spike/pull/8) | `web/e2e/isolation.spec.ts`, `web/e2e/permissions.spec.ts`, `web/e2e/ledger.spec.ts`, `web/e2e/events.spec.ts`, `web/e2e/production-build.spec.ts`, `web/e2e/design.spec.ts`, `test/api/me-schools.e2e-spec.ts`                                                                                                            | Every step                               | `web.sign-in-in-production`                                                                                                                                                                                     |

What each row of `pnpm prove` removes, and the tests that must fail for it,
is in `prove/sabotages.json`.

## Prove it yourself

```bash
pnpm prove
```

For each protection in `prove/sabotages.json` the command:

1. copies the files on disk to a directory outside the working tree;
2. applies one small patch there, from `prove/sabotages/`, that removes or
   weakens that protection;
3. runs only the tests named for it, against a database of its own;
4. requires each named test to have run and failed, with a failure message
   that contains the text the manifest states;
5. removes the copy.

Before any patch it runs all the named tests once with no patch, and stops
if one of them is not green. It prints one row per protection:

```text
passed  isolation.force-rls               FORCE ROW LEVEL SECURITY on students, so the table's owner is no longer bound by its policies
          failed as required: what the runtime role can reach is only ordinary tables with row-level security enabled and forced and a policy
passed  isolation.loose-policy            the school condition from the read side of the students policy
          failed as required: tenant isolation in the database reads with no tenant filter in the query school A sees only its own students
          failed as required: tenant isolation in the database with no tenant set students returns zero rows and no error
          failed as required: /schools/:schoolId/students concurrency 50 interleaved requests for A and B each see only their own rows
...
passed  web.sign-in-in-production         the rule that keeps the demo sign-in out of a production build
          failed as required: the demo sign-in is served in development and is not a route of the production build
          failed as required: the demo sign-in leaves no trace in the production build

30 sabotages: 30 passed, 0 FAILED
Time: 18 min 19 s
```

- `passed` means the tests caught the sabotage.
- `FAILED` means they did not: a named test passed, did not run, or failed
  for another reason, or the patch no longer applies to the code. The lines
  under the row say which.
- The exit code is zero only when every row passed.

It never commits, pushes or changes the working tree. It needs Docker, the
Chromium of the setup, and ports 3190, 3290, 3291 and 3390 free for the two
browser rows.

`pnpm prove ledger` runs one group and `pnpm prove isolation.force-rls` runs
one row. `--jobs=N` sets how many run at once.

The output above is from a full run of the thirty rows on a Windows laptop,
three at a time. It took 18 minutes, and every row passed. It is not part of the checks on a pull request. It is a workflow
that is started by hand (`.github/workflows/prove.yml`). What does run on
every pull request is a test that every patch still applies to the code as
it is (`test/prove/manifest.spec.ts`).

## Architecture in brief

- **Roles.** Four PostgreSQL roles. `app_owner` owns the tables and runs
  migrations and provisioning. `app_runtime` is the application and the
  worker's handlers: no DDL, no `DELETE`, column grants where a writer must
  not choose a value. `app_dispatcher` reads which event belongs to which
  school. `app_queue` runs the job queue in its own schema. None is a
  superuser and none bypasses row-level security.
  [Decision 2](docs/decisions/0002-the-reach-rule-and-roles.md).
- **Tenancy.** One database, one schema. Every school table has `tenant_id`
  in its key and a forced policy that compares it with a transaction-local
  setting. `TenantDb.run` (`src/db/tenant-db.ts`) sets the user, confirms a
  membership or a grant, then sets the school. `runForUser` sets no school,
  for `GET /me/schools`. `runForEvent` sets the school of an event after
  finding the event under that school.
  [Decision 1](docs/decisions/0001-tenant-isolation-in-the-database.md).
- **Requests.** A global guard verifies the token. A global interceptor
  (`src/db/tenant.interceptor.ts`) opens the school's transaction for any
  route with a school in its path, then checks the module, then the
  permission. The order of refusals is 401, 400, plain 403,
  `MODULE_DISABLED`, `PERMISSION_DENIED`.
  [Decision 3](docs/decisions/0003-secure-by-default.md).
- **Modules and permissions.** Areas are core or module
  (`src/entitlements/areas.ts`). Core is students. Modules are finance and
  admissions. A module refers to core and never to another module; modules
  meet through events.
  [Decision 4](docs/decisions/0004-modules-and-permissions.md).
- **Ledger.** `src/finance/ledger.service.ts` posts entries, invoices,
  reversals, conversions and revaluations, and locks periods. Triggers and
  constraints in `db/migrations/0006_ledger_guarantees.sql` decide whether a
  posting is allowed. Amounts are decimal strings and `BigInt` minor units
  (`src/finance/money.ts`). One route reads the ledger; none writes it.
  [Decision 5](docs/decisions/0005-ledger-guarantees-in-the-database.md),
  [decision 6](docs/decisions/0006-money-and-currencies.md).
- **Events.** `POST .../admissions/applications/:id/accept` writes
  `student.accepted` to `outbox_events` in its own transaction. The worker
  (`src/worker.ts`) has a dispatcher, an events queue and a webhook queue,
  each with a dead-letter queue. `src/events/event-runner.ts` decides the
  route at delivery and records it in `processed_events` with the effect.
  [Decision 7](docs/decisions/0007-events.md),
  [decision 8](docs/decisions/0008-delivery.md).
- **Calendar and invoices.** A trigger gives an invoice its number, instant
  and issue date. `src/calendar/hijri.ts` converts a Gregorian date with the
  runtime's Umm al-Qura calendar and a country's official month starts.
  [Decision 9](docs/decisions/0009-invoice-numbers-and-dates.md),
  [decision 10](docs/decisions/0010-arabic-rtl-and-hijri.md).
- **Web app.** `web/` is a Next.js app in the same workspace. It holds the
  user's token in a session cookie and no database connection. Every page
  renders in `web/components/screen.tsx`, with the server response beside it.
  The invoice is one component for the screen and the PDF.
  [Decision 11](docs/decisions/0011-the-web-app.md).

## Known limits

Each decision record lists its own. Together:

**Isolation, reach and requests**

- The owner role owns the tables, so a migration can drop a policy or a
  trigger. The migrations are the trust boundary.
- Token verification is HS256 with a shared secret, in place of an identity
  provider.
- `GET /me/schools` costs one short transaction per school.
- The route test reads the HTTP adapter's router, and the start-up check
  reads the framework's route metadata by key. Neither is a public API.

**Modules and permissions**

- A membership has one role, and roles are the same for every school.
- No route switches a module or writes a grant. Both are done as the owner.
- The request-time module check does not take the lock that event delivery
  takes.

**Ledger and money**

- No route writes the ledger.
- The database does not check that the two amounts of a conversion agree
  with the rate on the entry.
- A posting dated before an existing revaluation is not included in it.
  Locking the period prevents that.
- Period-end revaluation is not scheduled, and a locked period cannot be
  reopened.

**Events and delivery**

- The webhook secret is stored in plain text and the runtime role can read
  it in its school.
- Endpoint addresses are not checked against internal addresses.
- Nothing redrives a failed event or a failed delivery.
- There is one event type and one handler per event, no delivery order, and
  no per-school limit on worker concurrency.
- A dead-letter job that cannot find its event in its school is logged and
  is not recorded in the application's tables.

**Invoices, Arabic and Hijri**

- An owner import keeps the real instant and gets a new number. Imported
  invoices should keep their original number in a column of their own.
- An invoice has one description and one amount, with no lines.
- A Hijri override is checked when a date is converted, not when it is
  written. A wrong one hides the Hijri date on that country's invoices for up
  to twelve months after it, and only a log line says so.
- A Hijri day starts at midnight here, not at sunset.
- The Arabic copy needs a read by someone who works in a school office.

**Web app**

- The headless browser runs inside the web server, and nothing limits how
  many PDFs are printed at once.
- The session cookie has no `Secure` flag and the token lasts eight hours.
- The page that follows an acceptance asks again once a second for up to a
  minute. Nothing is pushed to it.
- The event of an application is found by a search of the payload, with no
  index.

**The proofs**

- The sabotages are hand-picked. A protection without one is covered by its
  tests only.
- `pnpm prove` has run on Windows. The workflow that runs it on Linux can be
  started only once it is on the default branch.

## Not proven yet

What a production school platform still needs that this spike has not
tested, and what each needs before it can be tested:

- **Importing from and exporting to the school information system in use
  today.** It needs a real extract from that system, with its real mess:
  duplicate students, missing guardians, old fee codes. Then a mapping to the
  data model, an import that runs as the owner role and keeps original
  invoice numbers and dates, and the reverse path that sends students back.
- **Sandbox calls to third-party education platforms, and importing and
  reconciling a payroll journal.** Each needs sandbox credentials and the
  provider's documentation. The payroll journal needs a sample file, a
  mapping of its lines to ledger accounts, and a reconciliation that the
  ledger's own totals can be checked against.
- **Schools reviewing screens built from their own forms and fee
  schedules.** The screens here show the proofs, not a school's work. This
  needs two or three schools' real admission forms and fee schedules, screens
  built from them, and people from those schools using them.
- **Choosing the identity provider (Keycloak or Cognito).** The API verifies
  a token and issues none, so the choice is open. It needs a test of each
  against the same cases: one login across schools, revoking access, and how
  the user id reaches the token's subject.
- **A render worker for PDFs.** The headless browser runs inside the web
  server. It needs a worker of its own with a queue, a limit on concurrent
  renders, and a test under load.
- **Secrets under KMS.** Webhook secrets are plain text in the database. It
  needs envelope encryption with a key the runtime role cannot use, readable
  by the sender only, and a rotation path.
- **Endpoint address checks before schools set their own endpoints.** Today
  only the owner writes an endpoint. Before a school can, the sender must
  refuse internal and link-local addresses, after resolving the name and
  again at connect time, and refuse redirects to them.

## Tests

Tests start their own PostgreSQL 16 container, so Docker must be running.
They do not use the database from `pnpm db:up`. They connect as the runtime
role, never as a superuser.

```bash
pnpm test                            # the API tests
pnpm test test/health.e2e-spec.ts    # one file
pnpm test:web                        # the web app's unit tests
pnpm test:e2e                        # the browser tests
pnpm prove                           # break each protection and check its tests
pnpm docs:data-model                 # regenerate docs/data-model.md
pnpm typecheck
pnpm lint
```

- **API tests:** 739. The files under `test/events` run a
  dispatcher or a worker, which act on every school, so they run after the
  others, one at a time.
- **Web unit tests:** 159.
- **Browser tests:** 152. They build the API and the web app,
  start a database of their own, and run the production build, a development
  server for the demo sign-in, the worker and the fake receiver.

The rules the tests follow:

- A test is written before the code and shown to fail for the right reason.
- A test that expects a refusal also shows that the thing it refuses exists.
- A check over a set has a companion that fails when the set is empty.
- A test that writes shared state has a school of its own.
- A query with more than one path to "yes" has a fixture per path where the
  condition holds in the wrong school.
- A test for a lock makes the two transactions overlap for certain.
- A balance used for a date is the balance as of that date.
