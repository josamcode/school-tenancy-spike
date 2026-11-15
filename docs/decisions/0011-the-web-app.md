# 11. The web app: one template for screen and PDF, every screen reads the API as the user, a development-only sign-in

## Context

The proofs in this repository are about the API and the database. A screen
adds value only if it shows the same thing the API enforces, and shows it
without becoming a second place where a rule can be wrong. The invoice also
exists twice, on the screen and as a PDF, and two copies of a document drift.

## Decision

- **Every screen reads the API as the signed-in user.** The web server holds
  a session cookie with the user's bearer token and no database connection
  (`web/lib/api.ts`). A screen cannot show what the API would refuse.
- **Each screen shows the server's answer beside itself.** Every page renders
  inside one shell (`web/components/screen.tsx`): what the user sees, and a
  panel with each call the page made, whether it was allowed or refused in
  words, its status, and the raw request line and body
  (`web/components/server-response.tsx`). A refusal is visible as the
  server's refusal, not as an empty page.
- **The web app does no arithmetic and makes no access decision.** The ledger
  route returns the figures; the web app formats strings. Instants arrive in
  UTC and are shown in the school's timezone, with the zone named.
- **The invoice is one component with one stylesheet**
  (`web/components/invoice-document.tsx`), rendered by the screen and by a
  bare print page. The PDF is that print page printed by a headless Chromium.
- **The PDF route asks the API first, as the caller,** and relays a refusal as
  it is. The address of a PDF is a web route, so the API's rules guard the
  data and the route must not answer before the API does.
- **The headless browser is fenced in.** It is sent only to an address built
  from the server's own configured origin, never from the request, and every
  request it makes to another origin is aborted.
- **The demo sign-in exists in development only.** Its files are named
  `page.dev.tsx` and `actions.dev.ts`, and the page extensions include `dev.*`
  only outside production (`web/next.config.ts`). A production build does not
  compile them. The API has no route that issues a token.
- **The fake webhook receiver is a development tool** (`dev/receiver.ts`). It
  is in neither build, listens on this machine only, and refuses to start in
  production.
- **The design is held by tests, not by a linter:** six color tokens, the
  bundled Noto faces, square corners, no shadows, and monospace for the raw
  response only.

## Alternatives considered

- **Rendering the PDF in the API.** It would put the PDF behind the API's own
  guards. It would also need a second copy of the template, the styles and
  the fonts, or React inside the API. We kept one template and made the route
  ask the API before it prints.
- **A PDF library that draws text itself.** Arabic shaping and bidirectional
  ordering are the hard part, and a browser already does both correctly. The
  tests read the PDF's own text operators and fonts to confirm it.
- **Screens that read the database for convenience.** A screen would then need
  the policies' logic again, in a second language.
- **A sign-in page guarded by an environment check at run time.** The code
  would still be in the production bundle. Leaving it out of the build is a
  property of the artifact, and a test reads the build to confirm it.
- **Hiding refused pages from the navigation.** It reads well in a product.
  Here the point is to see the server refuse, so the link stays and the
  refusal is shown.

## Consequences

- A change to an API rule shows on the screens with no change to the web app.
- The browser tests run against the production build, where there is no
  sign-in, so a test sets the session cookie itself. That also shows the app
  works without the demo path.
- The page that follows an acceptance asks the API again once a second, for
  up to a minute, until the outcome is known.

## Known limits

- The headless browser runs inside the web server process and is never
  closed. Nothing limits how many PDFs are printed at once.
- The session cookie has no `Secure` flag and the token lasts eight hours. A
  real sign-in replaces both.
- `GET /me/schools` costs one transaction per school.
- The event of an application is found by a search of the event payload, with
  no index.
- The address of the sign-in page survives in one source map of the
  production build. The page and its action do not.
- The reader that the tests use for PDFs understands what this Chromium
  writes. A browser upgrade may change that, and the tests would then fail.

## Evidence

- Pull requests: [#7](https://github.com/josamcode/school-tenancy-spike/pull/7),
  [#8](https://github.com/josamcode/school-tenancy-spike/pull/8).
- The routes the screens read: `test/api/me-schools.e2e-spec.ts`,
  `test/api/ledger-read.e2e-spec.ts`, `test/api/admissions-read.e2e-spec.ts`,
  `test/events/event-status.e2e-spec.ts`.
- Each screen against the API's answers: `web/e2e/isolation.spec.ts`,
  `web/e2e/permissions.spec.ts`, `web/e2e/ledger.spec.ts`,
  `web/e2e/events.spec.ts`, `web/e2e/invoice.spec.ts`.
- The PDF answers as the API does, and embeds only the bundled fonts:
  `web/e2e/pdf.spec.ts`.
- The sign-in and the receiver are in no production build:
  `web/e2e/production-build.spec.ts`, `web/e2e/receiver-build.spec.ts`,
  `test/dev/receiver.spec.ts`.
- The design rules: `web/test/design-rules.spec.ts`, `web/e2e/design.spec.ts`.
- `pnpm prove` rows: `web.no-bundled-fonts`, `web.sign-in-in-production`.
