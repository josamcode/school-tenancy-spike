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
```

`pnpm db:up` starts PostgreSQL 16 on `127.0.0.1:5440`. On first start it runs
`db/bootstrap/roles.sql`, which creates two roles:

- `app_owner` owns the database and runs migrations.
- `app_runtime` is used by the app and by every test. It is not a superuser,
  cannot bypass row-level security and owns no table.

The passwords in `db/bootstrap/roles.sql`, `docker-compose.yml` and
`.env.example` are local development values. They protect nothing and must not
be reused anywhere else.

## Run

```bash
pnpm start:dev
curl http://localhost:3100/health
```

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
```
