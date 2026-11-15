# 1. Tenant isolation in the database: forced row-level security and one place that sets the school

## Context

Many schools share one database. The failure we most want to rule out is one
school reading or writing another school's rows. It has three usual causes:

- a query that forgets its school filter;
- a pooled connection that still carries the previous request's school;
- a school id that the client supplies and the server trusts.

A rule that every query must remember does not hold for the life of a product.

## Decision

We put the isolation in PostgreSQL and leave the application one narrow way to
say which school a transaction is for.

- **Row-level security is enabled and forced on every table a school owns.**
  One policy covers reads and writes: `tenant_id` must equal the setting
  `app.tenant_id`. Forced means the table's owner is bound too
  (`db/migrations/0001_row_level_security.sql`).
- **`tenant_id` is `NOT NULL` and defaults to the current school.** Application
  code never passes a school on insert. With no school set, the insert is
  refused.
- **The setting is local to a transaction.** It is set with
  `set_config(..., true)`, so it ends with the transaction and a connection
  goes back to the pool with nothing on it.
- **`TenantDb.run` is the only code that sets `app.tenant_id`**
  (`src/db/tenant-db.ts`). It sets `app.user_id` first, confirms a membership
  or a grant in that school, and only then sets the school. No caller can skip
  the check.
- **A second setting, `app.user_id`, covers what is read before the school is
  confirmed:** the user's own row, memberships and grants.
- **A handle dies with its transaction.** A query on a handle kept past the
  end of its transaction throws instead of running on a connection that now
  serves someone else.
- **A failed rollback destroys the connection.** It may still be inside the
  transaction with the school set, so it is never returned to the pool.
- **Every primary key, unique constraint and foreign key between two school
  tables includes `tenant_id`.** Foreign key checks bypass row-level security,
  so a single-column key would let an invoice point at another school's
  student.
- **The school comes from the path only,** as a canonical uuid, and is
  confirmed against the user. A school id in a header, the query string or the
  body has no effect.
- **No access and no such school get the same 403,** so the API does not
  reveal which schools exist.

## Alternatives considered

- **A school filter in every query, or in an ORM scope.** One forgotten filter,
  one raw query or one new join leaks, and nothing fails when it happens. We
  wanted the unsafe query to return nothing by construction.
- **A schema or a database per school.** It isolates well, but every migration
  runs once per school, connection pools multiply, and a user who works in two
  schools or a group that reads across schools needs a second mechanism. The
  spike's other proofs (one login across schools, grants across a group) are
  simpler in one schema.
- **Row-level security without `FORCE`, with the application connecting as the
  owner.** The owner would bypass every policy. We use a separate runtime role
  and force the policies, so even the role that runs the seed writes school
  rows through them.
- **A session-level setting.** It survives the transaction and travels with
  the pooled connection to the next request.
- **A role with `BYPASSRLS` for work that crosses schools.** It is a master
  key. Where one process must read across schools, it gets a narrow policy on
  named columns instead (see [decision 2](0002-the-reach-rule-and-roles.md)).

## Consequences

- Every request that touches a school runs in one transaction.
- A query with no school set returns no rows and no error. Tests assert both.
- The seed and provisioning go through the same policies as the application.
- A unique constraint on an id alone is not allowed, and a test fails when one
  is added.
- A route with a school in its path gets the transaction from a global
  interceptor (see [decision 3](0003-secure-by-default.md)); a route without
  one cannot reach the database through `TenantDb.run` at all.

## Known limits

- The owner role owns the tables, so a migration can drop a policy. The
  migrations are the trust boundary, and the tests run against what they
  build.
- The rollback-failure test kills the backend. A rollback that fails on a live
  connection takes the same code path but is not exercised.
- `GET /me/schools` opens one short transaction per school to read its name.

## Evidence

- Pull request: [#2](https://github.com/josamcode/school-tenancy-spike/pull/2).
- Policies and constraints as the runtime role: `test/db/isolation.spec.ts`,
  `test/db/constraints.spec.ts`, `test/db/user-scope.spec.ts`.
- The one place that sets the school: `test/db/tenant-db.spec.ts`,
  `test/db/tenant-db-failed-rollback.spec.ts`.
- Over HTTP, including 50 interleaved requests for two schools and a school id
  supplied by the client: `test/api/students.e2e-spec.ts`.
- On the screen: `web/e2e/isolation.spec.ts`.
- `pnpm prove` rows: `isolation.force-rls`, `isolation.loose-policy`,
  `isolation.no-membership-check`, `isolation.single-column-fk`.
