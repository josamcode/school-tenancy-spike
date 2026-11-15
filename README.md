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

`pnpm db:seed` adds two schools, one user in each, one user in both, and a few
students and invoices. The ids are in `db/seed.ts`.

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
