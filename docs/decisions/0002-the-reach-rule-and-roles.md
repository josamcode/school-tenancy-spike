# 2. The reach rule: what the runtime role may touch, and separate roles for the owner, the dispatcher and the queue

## Context

"Every table has row-level security" is true on the day it is written. It
stops being true when someone adds a table, a view, or a library that brings
its own tables, and nothing fails when that happens. We wanted a rule that is
checked against the database as it is, not against a list someone maintains.

The spike also has work that does not fit one role: migrations and
provisioning, a dispatcher that must see events of every school, and a job
queue that installs its own tables.

## Decision

We state isolation as a property of the role the application connects as, and
we give each other kind of work a role of its own.

- **The reach rule.** Every relation on which `app_runtime` holds any
  privilege, on the table or on a column, must be an ordinary table in the
  `public` schema with row-level security enabled, forced, and at least one
  policy. `app_runtime` has no access to any other schema, and cannot create a
  relation, temporary ones included. A test reads this from the catalog, so a
  new table is covered without being named.
- **`app_owner`** owns the tables and runs migrations, provisioning and the
  seed. It is not a superuser. Forced row-level security binds it.
- **`app_runtime`** is the application and the worker's handlers. It has no
  DDL, no `DELETE` and no `TRUNCATE`. Where a writer must not choose a value,
  the grant is by column: it can insert an event's `type` and `payload` only,
  and an invoice without its number or issue date.
- **`app_dispatcher`** reads four columns of the outbox across schools and
  updates one. Two policies written `TO app_dispatcher` allow exactly that. It
  has no `BYPASSRLS`.
- **`app_queue`** runs the job queue in the `pgboss` schema and reaches no
  application table.
- **The roles are created by a bootstrap script** that the image's superuser
  runs once (`db/bootstrap/roles.sql`). The superuser is used for nothing else.
- **Catalogs and reference tables follow the rule too.** Where the runtime
  role reads one, it has a read policy `USING (true)`: it restricts nothing
  and keeps the rule without exceptions.
- **Tests connect as `app_runtime`.** The owner's connection is used only where
  the runtime role cannot do the thing at all, such as provisioning.

## Alternatives considered

- **A list of tables that must have row-level security.** The list is the
  thing that drifts. The rule is about what the role can reach, so it is read
  from the catalog.
- **`BYPASSRLS` for the dispatcher.** It would read every column of every
  table. The dispatcher needs to know which event belongs to which school,
  and nothing else.
- **A `SECURITY DEFINER` function for the cross-school read.** It works, but
  the path then runs as its owner and a test that lists privileges no longer
  shows the whole of what the dispatcher can do.
- **Enqueueing jobs on the application's connection.** The queue's tables live
  outside `public` and have no row-level security, so the runtime role would
  need rights that break the rule, and could enqueue a job for any school.
- **A view for the student sub-ledger.** A view is not an ordinary table and
  fails the rule. The sub-ledger is a query.

## Consequences

- A table granted to the runtime role without row-level security fails a test
  on the pull request that adds it.
- A library that needs its own schema needs its own role.
- The data model document lists, for every table, what each role may do
  ([data model](../data-model.md)).

## Known limits

- The rule says nothing about the owner or a superuser. Both can change it
  with DDL.
- The role passwords are committed and named `dev_only_*`. They are for a
  local database and for tests.
- The queue's tables are created by the queue library when a worker first
  starts, as `app_queue`. They are not in the migrations.
- A `USING (true)` policy is a formality. It is there so that the rule has no
  exception to remember.

## Evidence

- Pull requests: [#2](https://github.com/josamcode/school-tenancy-spike/pull/2),
  [#6](https://github.com/josamcode/school-tenancy-spike/pull/6).
- The rule, read from the catalog: `test/db/reach.spec.ts`.
- The roles: `test/db/role.spec.ts`, `test/db/event-roles.spec.ts`.
- Column grants: `test/db/event-tables.spec.ts`, `test/db/invoice-rules.spec.ts`.
- `pnpm prove` rows: `reach.table-without-rls`, `reach.other-schema`,
  `isolation.force-rls`.
