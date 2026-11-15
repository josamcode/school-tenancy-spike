# school-tenancy-spike

A technical spike for a multi-tenant school platform. It exists to prove the
riskiest assumptions with tests: tenant isolation enforced by PostgreSQL
row-level security, module entitlements, permissions across schools, a
double-entry ledger, transactional events, and Arabic, RTL and Hijri output.

It is short-lived code, not a product.

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
`db/bootstrap/roles.sql`, which creates four roles:

- `app_owner` owns the database, runs migrations and seeds data.
- `app_runtime` is used by the app, by event handlers and by the tests. It is
  not a superuser, cannot bypass row-level security and owns no table.
- `app_dispatcher` is used by the worker to move events from the outbox to the
  queue. It can read which event belongs to which school and nothing else.
- `app_queue` is used by pg-boss. It works only inside the `pgboss` schema.

The script runs only when the data directory is empty. A database created
before a role was added must be reset, as described at the end of this file.

`pnpm db:seed` adds two schools with finance on, one user in each, one user in
both, and a few students and invoices. It also adds three schools for the
module tests: one with finance switched off, one with no finance row, and one
that a single test switches on and off. For the permission tests it adds a
staff user, a group with an admin who holds one grant, a user who is staff in
one school and holds a grant in another, and three more schools that single
tests write to. For the ledger tests it adds four schools with finance on and
AED as base currency, each written by one test file. For the event tests it
adds schools that single tests write to, each with one student, and a few
pending admission applications. For the calendar tests it adds schools in five
countries and five timezones, with invoices issued at fixed instants, and
three official Hijri month starts, which are test fixtures and not a record of
real announcements. Every other school is in `Asia/Dubai` and has no country.
For the demo screens it adds five schools with Arabic and English names, four
users, a ledger that holds the netting scenario of the ledger tests with
December 2025 locked, a registration fee, a webhook endpoint at the local
fake receiver, and six pending admission applications in each of two schools.
Accepting an application uses it up. A database reset, described at the end
of this file, brings all six back. The ids are in `db/seed.ts`.

The passwords in `db/bootstrap/roles.sql` and `docker-compose.yml`, and every
value in `.env.example` including `JWT_SECRET`, are local development values.
They protect nothing and must not be reused anywhere else.

## Run

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

The web app is a demo of the proofs, not a product. One command runs all of
it:

```bash
pnpm dev
```

It starts four processes: the API on 3100, the web app on 3200, the worker
that delivers events, and a fake webhook receiver on `127.0.0.1:3300`.
`http://localhost:3200` goes to the Arabic app at `/ar`; `/en` is the English
one. There is no identity provider yet, so in development `/ar/dev/sign-in`
signs you in as a seed user. It is labelled as a demo, and it is the guide to
the demo: one group per proof, and each entry lands on the page that shows it.
Every screen reads its data from the API as that user, and shows beside it
what the server sent back for each call: the status, the code and the body.

The worker is a process of its own:

```bash
pnpm start:worker
```

It needs `DISPATCHER_DATABASE_URL` and `QUEUE_DATABASE_URL` as well as
`DATABASE_URL`. The app needs neither and is never given them. On first start
pg-boss creates its tables in the `pgboss` schema.

Started this way the worker builds into `dist-worker` (`tsconfig.worker.json`)
and the API's watcher into `dist`. Each deletes only its own directory before
it builds, so the two can start together under `pnpm dev`.

The fake receiver (`dev/receiver.ts`, `pnpm start:receiver`) stands in for a
school's own system. It checks the signature of each webhook, answers 401
when it does not match, and reports what it received at
`/received/<event id>`. It exists in development only: it is outside both
applications, in neither build, and refuses to start when `NODE_ENV` is
`production`. The development web server asks it what it recorded and shows
that on the page that follows an acceptance; a production build does not.

## How tenant isolation works

- Every table the runtime role can reach has row-level security enabled and
  forced. Policies compare `tenant_id` with the `app.tenant_id` setting.
- The token identifies the user only. The school comes from the path.
- Each request runs in one transaction. It sets `app.user_id`, checks that the
  user is a member of the school, and only then sets `app.tenant_id`. Both
  settings end with the transaction.
- Application code reaches the database only through that transaction. A call
  outside it, or after it has ended, throws.
- Both checks are global. Every route needs a token unless it is marked
  `@Public()`, and `GET /health` is the only public route. Every route with a
  `schoolId` path parameter runs inside the tenant transaction. A new
  controller gets both without declaring anything.
- If a rollback fails, the connection is destroyed instead of going back to
  the pool, because it may still carry the previous request's tenant.
- Core tables (`tenants`, `users`, `memberships`, `students`) are always on.
  Module tables, starting with finance, may reference core tables but never
  another module's tables.

## How module entitlements work

- A module is on for a school only when `tenant_modules` has a row for it with
  `enabled = true`. A missing row means off.
- Module names live in the `modules` table, and `tenant_modules.module`
  references it, so a misspelt name cannot be stored. The list in
  `src/entitlements/modules.ts` must match it, and a test compares the two.
- The module check runs inside the tenant transaction, after the user's access
  to the school is confirmed, and reads the table on every request. Someone
  with access to a school that has the module off gets 403 with
  `code: "MODULE_DISABLED"`.
- Only `app_owner` can switch a module on or off. With `app.tenant_id` set to
  the school:

```sql
insert into tenant_modules (module, enabled) values ('finance', true)
on conflict (tenant_id, module) do update set enabled = excluded.enabled;
```

## How permissions work

- A permission is an area and an action: `students:read`, `students:create`,
  `finance:read`. Every area is declared in `src/entitlements/areas.ts` as
  `core` or `module`. Nothing is core by default: a permission whose area is
  not in that map does not compile.
- Every route with a `schoolId` declares one permission with
  `@RequiresPermission(...)`. The area decides whether the module check runs,
  and the permission is what the user must hold. If such a route declares no
  permission, or one that is not in the list, the app does not start and the
  error names the route.
- There are two ways to hold a permission in a school:
  - a membership with a role, where `role_permissions` says what the role
    holds: `school_admin` holds every permission and `staff` holds
    `students:read`;
  - a grant: a row of user, school and permission, for someone who is not a
    member.
- A group (`groups`, `group_schools`, `group_admins`) is an administrative
  link only. No row in those tables gives access to a school.
- The order of answers is fixed: 401 for no or bad token, 400 for a malformed
  school id, the plain 403 for no membership and no grant in that school or an
  unknown school, 403 `MODULE_DISABLED`, then 403 `PERMISSION_DENIED`. Someone
  with no access to a school learns nothing about it.
- Every check reads the database on each request, so removing a membership or
  a grant takes effect on the next one.
- Permissions and roles are catalog tables with foreign keys, so a misspelt
  one cannot be stored. Only `app_owner` writes memberships, grants, role
  permissions and groups.
- Known limit: a membership has exactly one role, and roles are the same for
  every school.

## How the ledger works

The ledger belongs to the finance module. It has no HTTP routes yet.

- Amounts are `numeric(19,4)` with a currency. A line carries one signed
  amount: positive is a debit and negative is a credit.
- An account has exactly one currency, and a line must be in its account's
  currency.
- Three rules are enforced by the database, for every role that writes rows:
  - every entry balances in each currency when its transaction commits;
  - posted entries and lines cannot be updated, deleted or truncated, and
    lines can only be added in the transaction that posts their entry;
  - nothing posts into a locked period, and a locked period cannot be
    reopened.
- A correction is a new entry that negates the original line for line. An
  entry can be reversed once.
- Rounding follows the currency: a line cannot carry more decimals than its
  currency has (2 for AED, SAR and QAR; 3 for BHD, KWD and OMR). Conversions
  round half away from zero. A split hands its remainder out one minor unit at
  a time from the first part, so the parts always sum to the total.
- Currency conversion goes through one FX position per foreign currency: an
  account in that currency and an account in the base currency. Each currency
  therefore balances by itself. Revaluing a position sets its base side to
  `-(foreign-side balance) x rate` and posts the difference to FX gain or
  loss; closing a position is the same operation when the foreign side is
  zero.
- A conversion uses the school's latest rate on or before the entry date and
  copies it onto the entry, so a later change to the rate table does not alter
  history.
- A revaluation uses both sides' balances as of its date: only lines whose
  entry is dated on or before it. Entries dated later belong to a later
  revaluation, even when they were posted first.
- A revaluation takes an advisory lock for its school and currency
  exclusively, and a conversion takes it shared, so two revaluations cannot
  book the same difference twice and a conversion cannot slip in between the
  read and the post.
- Posting an invoice reads it under a share lock, so a change made while the
  posting is open waits and is then refused.
- The student sub-ledger is derived from the lines on control accounts, per
  student and currency. Every line on a control account names a student.
- A school's base currency is set once in `finance_settings` and cannot be
  changed. Periods belong to financial years, cannot overlap, and several
  years can be open at once.
- Amounts in TypeScript are decimal strings and `BigInt` minor units
  (`src/finance/money.ts`). There is no floating point.

Known limits: the owner role owns the tables, so it can disable a trigger
with DDL; and the database does not check that the two amounts of a conversion
agree with the stored rate.

## How events work

Accepting a student emits `student.accepted`. Finance charges a registration
fee for it where finance is on; otherwise the school's own system receives it
as a webhook. Every event goes to exactly one of the two.

- **Emission.** `POST /schools/:schoolId/admissions/applications/:id/accept`
  belongs to the admissions module and needs `admissions:accept`. It locks the
  application, creates the student, marks the application accepted and writes
  a row to `outbox_events`, all in the request's transaction. If the
  acceptance rolls back there is no event; if it commits, the event is stored.
  The runtime role can only append to the outbox, and names only the type and
  the payload.
- **Dispatch.** The worker's dispatcher copies committed events into pg-boss
  (`src/events/dispatcher.ts`). It connects as `app_dispatcher`, the only role
  that reads across schools. Its whole reach is four columns of the outbox:
  the event id, the school id and two timestamps. It cannot read a payload. It
  sends first and marks second, so a crash between the two sends the event
  again under the same job id.
- **The queue.** pg-boss runs as `app_queue` in a schema of its own. The
  runtime role has no access to that schema, so the reach rule still holds. A
  job carries an event id and a school id; the payload stays in the outbox.
- **Handlers run as a request would.** `TenantDb.runForEvent` sets the school
  from the job and then loads the event under that school's row-level
  security. A job that names the wrong school finds nothing and no handler
  runs. The user is the one who accepted the student, read from the event.
- **Routing is decided at delivery, once.** A handler declares its event and
  its module with `@HandlesEvent`; the worker refuses to start on a wrong
  declaration, and a class without one is never called. The runner reads
  whether the module is on under an advisory lock that a trigger on
  `tenant_modules` also takes, so a switch and a routing decision wait for
  each other. The decision is a row in `processed_events`, whose key allows
  one handler per event, written in the same transaction as the handler's
  effect. A switch after that changes nothing for that event.
- **At least once.** A second delivery finds the row and does nothing, so an
  event delivered twice charges once. That covers a worker that dies after the
  effect commits and before its job is marked done.
- **A handler that keeps failing.** An events job is retried with exponential
  backoff: 5 retries, starting at 1 second. After the last one pg-boss copies
  it to a dead-letter queue, whose worker writes one row to `event_failures`
  in the event's school: the event id, the time and the last error. A school
  with finance on and no registration fee, or an acceptance dated in a locked
  period, ends there, with nothing in the ledger. If the event is not visible
  in the job's school the failure is logged, the dead-letter job fails, and
  nothing is recorded.
- **The fee date** is the acceptance's date in the school's timezone
  (`tenants.timezone`, an IANA name), not the day the worker runs.
- **The webhook.** Each school has one endpoint and one secret
  (`webhook_endpoints`). A delivery is a JSON body with three headers, after
  the Standard Webhooks convention: `webhook-id` is the event id and is the
  same on every retry, so it is the receiver's idempotency key;
  `webhook-timestamp` is the send time in seconds; `webhook-signature` is
  `v1,` and the base64 HMAC-SHA256 of `id.timestamp.body`. A receiver verifies
  the signature, refuses a timestamp more than five minutes off and ignores
  an id it has already processed.
- **No transaction during the request.** The sender reads the endpoint in one
  short transaction, sends with a timeout of 5 seconds, and records the
  attempt in another. A slow endpoint holds no connection and no lock.
- **Failures.** A failed attempt is retried by pg-boss with exponential
  backoff: 5 retries, starting at 30 seconds. After the last one the job goes
  to a dead-letter queue whose worker marks the delivery `failed`. Each
  delivery is its own job in its own queue, so it holds up no other school and
  no finance handler. Every attempt is a row in `webhook_attempts`.
- **Handoff.** The routing transaction commits before the delivery job is
  sent. Every run of an events job whose delivery is still pending sends that
  job again, keyed by the event id, and completes only after the send.

Known limits: the webhook secret is stored in plain text and the runtime role
can read it within its school; endpoint URLs are not checked against internal
addresses; there is no per-school limit on worker concurrency; delivery order
is not guaranteed; nothing redrives a failed event; and nothing redrives a
failed delivery.

## How Arabic, RTL and Hijri work

- **Languages.** Arabic first, English second. The language is the first
  segment of the address and it alone sets `lang` and `dir` on the page. The
  switch opens the same page in the other language.
- **Layout.** The stylesheets use logical properties only (`margin-inline`,
  `text-align: start`). A test reads every stylesheet and style prop in `web`
  and rejects the words `left` and `right`, and four-value shorthands whose
  two sides differ.
- **Mixed direction.** Text that may be in the other script (a student's name,
  an invoice number, an amount with its currency code) is in a `<bdi>`, so its
  direction comes from its own letters. Tests measure where the glyphs are
  drawn, in both languages, on the screen and in the PDF.
- **Digits** are Western (123) in both languages.
- **Translated content** is a JSONB value on its row, `{"ar": …, "en": …}`,
  with one or both languages and nothing else: an invoice's description and a
  school's `name_i18n`. A language that is missing falls back to the other,
  and a school with no translated name shows `name`. Interface text is two
  catalogs in `web/messages` with the same keys.
- **Fonts.** Noto Sans and Noto Sans Arabic (SIL Open Font License) come from
  npm packages and are served by the app. No page asks another host for
  anything.
- **The invoice** gets three things from the database when it is inserted,
  whoever inserts it: a number that counts up per school (`INV-000042`, never
  reset), the instant it was issued, and its issue date, which is that instant
  in the school's timezone. The number is the school's highest plus one, read
  under an advisory lock that every insert in that school takes. None of the
  three can be changed afterwards.
- **No back-dating.** The runtime role has column-level INSERT on invoices and
  cannot name the number, `issued_at` or `issue_date`. Only the owner role can
  supply `issued_at`, for an import of existing invoices. The issue date and
  the number still come from the trigger.
- **`GET /schools/:schoolId/invoices/:invoiceId`** needs `finance:read` and
  follows the order of answers above, then 400 for a malformed invoice id and
  404 for an invoice that is not in this school. It returns the amount at its
  currency's decimals (three for BHD) and each date in both calendars.
- **Dates.** Only Gregorian dates are stored. A Hijri date is worked out for
  display, by the API, from the school's country: an official month start
  first (`hijri_month_overrides`, per country, written by the owner), then the
  calculated Umm al-Qura calendar from the runtime's ICU data. A school with
  no country gets the calculated date.
- **An override must fit.** It may move a month's start by at most two days,
  and the month before it must still have 29 or 30 days. If it would have 28
  or 31, the conversion throws and names the country, the month and the
  override that is probably missing. Nothing is clamped silently. A month
  after an override that is not announced yet starts where it was calculated,
  moved only as far as 29 or 30 days need.
- **A Hijri date that cannot be worked out does not stop the invoice.** The
  stored date is Gregorian and the Hijri date is display only. When the
  conversion throws, for a wrong override or any other reason, the route still
  answers 200: that date keeps its Gregorian value and its `hijri` is `null`.
  The screen and the PDF show the Gregorian date and "Hijri date unavailable"
  in the page's language. The API logs the date, the country, the month, the
  override and the reason. Other dates on the invoice and other countries are
  not affected.
- **The PDF** is the web app's own print page, printed by headless Chromium
  (Playwright). The screen and the print page render one component with one
  stylesheet and the same font files. The PDF route asks the API for the
  invoice first, as the caller, and relays any refusal. The browser is then
  sent only to this app's own address and is refused every other host.
- **The demo sign-in** exists only in development. Its files are named
  `page.dev.tsx` and `actions.dev.ts`, and `next.config.ts` makes `*.dev.tsx`
  a route extension only when `NODE_ENV` is not production, so a production
  build does not compile them. A test builds the app and finds no such route,
  no trace of those files in the output, and a 404 at the address. The API has
  no route that issues a token.

Known limits: a headless browser belongs in a render worker of its own, not
in the web server; nothing limits how many PDFs are printed at once; an
override is checked when a date is converted, not when it is written; a Hijri
day starts at midnight here, not at sunset; and an invoice has one
description and one amount, with no lines.

## How the demo screens work

Each proof has a screen, and every screen shows two things side by side: what
a user would see, and the server response for each call the page made.

- **The caller's schools.** `GET /me/schools` has no school in its path. It
  runs in a transaction that sets `app.user_id` and never `app.tenant_id`, so
  every policy that looks at the school matches nothing. What is left to read
  is the caller's own memberships and grants. Each school's name is then read
  in a transaction of its own, through the same path as any school route,
  which confirms the access again. The same answer carries each school's
  timezone. The API returns instants in UTC, and a screen shows them in the
  school's timezone, with the zone named in the page's language.
- **Isolation.** The students page lists the caller's schools and one
  school's students, by name and then by id. A school that is not theirs, and an id that names no
  school, get the same plain 403.
- **Modules and permissions** are one page: a real call to each of the
  school's four pages, with what the server answered. Where a module is off
  the answer is `MODULE_DISABLED`; where the user lacks the permission it is
  `PERMISSION_DENIED`. The app has no switch for a module. Switching one is
  the owner's right, and the web server holds no owner credentials.
- **The ledger.** `GET /schools/:schoolId/ledger` (`finance:read`) returns the
  total per currency, each student's balance, the FX positions, the FX gain
  or loss and the periods. It is the only ledger route. No route posts an
  entry.
- **Events.** `GET /schools/:schoolId/admissions/applications` and
  `GET .../applications/:applicationId/event` (`admissions:read`) list the
  applications and say what became of an acceptance: when it was dispatched,
  where it was routed, and each delivery attempt. The endpoint's secret is
  never returned. The fee is read from the ledger route, so admissions code
  reads no finance table.
- **The design** is six colors, the bundled Noto faces, square corners and no
  shadows. Monospace is used for the raw server response only. Tests hold
  the stylesheets, the catalogs and the rendered pages to these rules.

Known limits: `GET /me/schools` costs one short transaction per school;
the page that follows an acceptance asks the API again once a second, for up
to a minute, and nothing is pushed to it; the event of an application is
found by a search of the event payload, with no index; and each demo school
has six pending applications, which a database reset brings back.

## Test

Tests start their own PostgreSQL 16 container with Testcontainers, so Docker
must be running. They do not use the database from `pnpm db:up`.

The files under `test/events` run a dispatcher or a worker, which act on every
school. They run after the other files, one at a time.

The browser tests build the API and the web app, start a database of their
own, and run both with Playwright: the production build of the web app, and a
development server for the demo sign-in. They also start the worker and the
fake receiver, so an acceptance can be followed to its end.

```bash
pnpm test                            # the API tests
pnpm test test/health.e2e-spec.ts    # one file
pnpm test:web                        # the web app's unit tests
pnpm test:e2e                        # the browser tests
pnpm typecheck
pnpm lint
```

## Reset the local database

A database that holds invoices from before they had numbers must be reset:
the migration adds the number as a required column. A reset also brings back
the pending applications of the demo schools.

```bash
docker compose down -v
pnpm db:up
pnpm db:migrate
pnpm db:seed
```
