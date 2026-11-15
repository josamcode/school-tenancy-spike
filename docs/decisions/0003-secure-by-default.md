# 3. Secure by default: a global guard, declared routes and a fixed order of refusals

## Context

A route is added many times in the life of a product. Each time, someone can
forget the guard, the school transaction or the permission. A forgotten
decorator that fails closed is good. A forgotten decorator that cannot be
written at all is better.

What a refusal says also matters. An answer that differs between "no such
school" and "not your school" tells a stranger which schools exist.

## Decision

- **The token guard is global.** `AuthGuard` is registered as the
  application's guard, so a controller that declares nothing still needs a
  token (`src/auth/auth.module.ts`).
- **`@Public()` is the only way out, and the public set is pinned.** A test
  reads the routes from the running router and requires that the routes
  answering without a token are exactly `GET /health`.
- **The school transaction is global.** `TenantInterceptor` wraps every route
  that has a school in its path (`src/db/tenant.interceptor.ts`). A route
  without one gets no transaction and cannot query school data.
- **Every school route declares one permission,** and the application refuses
  to start when one does not, naming the route
  (`src/entitlements/route-declarations.ts`). The request-time check stays as a
  second line and answers 500 without running the handler.
- **The token must carry `exp` and a uuid `sub`.** The library does not require
  an expiry by default, and a subject that is not a uuid would fail a cast
  inside a policy and answer 500.
- **Refusals come in one order:** 401, then 400 for a malformed school id, then
  the plain 403 for no access or no such school, then `MODULE_DISABLED`, then
  `PERMISSION_DENIED`. The module and permission checks run inside the school
  transaction, after access is confirmed, so someone with no access learns
  nothing about the school.
- **The application verifies tokens and issues none.** There is no login
  route. Tests and the development sign-in sign their own tokens.

## Alternatives considered

- **A guard on each controller.** It is the framework's usual pattern. A new
  controller without it is open, and only a careful reader notices.
- **A lint rule or a convention for declarations.** It is checked outside the
  running application and can be skipped. The start-up check cannot.
- **A default permission derived from the route.** A route would then be
  reachable under a permission nobody chose.
- **404 for a school the user is not in.** It hides existence equally well. We
  chose one 403 for both cases, because the caller did name a resource and was
  refused.
- **Validating the school id in a pipe.** Interceptors run before pipes, so
  the membership query would run on a malformed id first.

## Consequences

- A new route is closed until it says otherwise, and cannot be deployed
  without a permission.
- The order of refusals is part of the API and is tested on every route
  family.
- Adding a second public route is a visible change to one test.

## Known limits

- Token verification is HS256 with a shared secret. It stands in for an
  identity provider, which is not chosen.
- The route test enumerates routes from the HTTP adapter's router, which is
  not a public API.
- The start-up check reads the framework's route metadata by key. If an
  upgrade renames the keys, the check finds no routes and the start-up tests
  fail.
- The request-time module check does not take the module lock that event
  delivery takes (see [decision 8](0008-delivery.md)). A request that races a
  switch sees the state before or after it.

## Evidence

- Pull requests: [#2](https://github.com/josamcode/school-tenancy-spike/pull/2),
  [#3](https://github.com/josamcode/school-tenancy-spike/pull/3),
  [#4](https://github.com/josamcode/school-tenancy-spike/pull/4).
- Every route needs a token, and an undecorated controller is still guarded:
  `test/api/secure-by-default.e2e-spec.ts`.
- The start-up check and its second line: `test/api/route-declarations.e2e-spec.ts`.
- Tokens and the order of refusals: `test/api/students.e2e-spec.ts`,
  `test/api/invoice.e2e-spec.ts`, `test/api/ledger-read.e2e-spec.ts`,
  `test/api/admissions.e2e-spec.ts`.
- `pnpm prove` rows: `auth.guard-not-global`, `modules.undeclared-route`.
