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
cp .env.example .env
pnpm db:up
pnpm db:migrate
pnpm db:seed
```

`pnpm db:up` starts PostgreSQL 16 on `127.0.0.1:5440`. On first start it runs
`db/bootstrap/roles.sql`, which creates two roles:

- `app_owner` owns the database, runs migrations and seeds data.
- `app_runtime` is used by the app and by the tests. It is not a superuser,
  cannot bypass row-level security and owns no table.

`pnpm db:seed` adds two schools with finance on, one user in each, one user in
both, and a few students and invoices. It also adds three schools for the
module tests: one with finance switched off, one with no finance row, and one
that a single test switches on and off. For the permission tests it adds a
staff user, a group with an admin who holds one grant, and two more schools
that single tests write to. The ids are in `db/seed.ts`.

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

## Test

Tests start their own PostgreSQL 16 container with Testcontainers, so Docker
must be running. They do not use the database from `pnpm db:up`.

```bash
pnpm test                            # all tests
pnpm test test/health.e2e-spec.ts    # one file
pnpm typecheck
pnpm lint
```

## Reset the local database

```bash
docker compose down -v
pnpm db:up
pnpm db:migrate
pnpm db:seed
```
