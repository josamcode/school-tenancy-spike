# 12. How the proofs are kept honest: a real PostgreSQL as the runtime role, and sabotage runs

## Context

A spike claims that certain things cannot happen. A green test suite supports
the claim only if the tests would turn red when the thing does happen. Tests
against a mock, tests that run as a superuser, and tests that pass because
the thing they refuse does not exist yet all look the same in a report.

## Decision

- **Tests run against a real PostgreSQL 16,** started for each run in a
  container, with the same bootstrap script and the same migrations as any
  other environment (`test/support/database.ts`).
- **Tests connect as the runtime role.** The application under test receives
  only that role's connection string. The owner's connection is used where
  the runtime role cannot do the thing at all.
- **A test is written before the code and shown to fail for the right
  reason.** A refusal test must also show that the thing it refuses exists. A
  check over a set has a companion that fails when the set is empty.
- **A test for a lock makes the two transactions overlap for certain.** It
  holds one open, uncommitted, and goes on only when the other is seen
  waiting for a lock the first one holds, or is refused at once by a lock
  timeout. It never waits for a fixed time.
- **A test that writes shared state has a school of its own.** Test files run
  in parallel against one database.
- **Files that run a dispatcher or a worker run after the others, one at a
  time** (`vitest.config.ts`). A dispatcher acts on every school.
- **Each protection is broken on purpose, and its tests must catch it.**
  `pnpm prove` (`prove/prove.ts`) takes each sabotage in `prove/sabotages.json`,
  a small patch that removes or weakens one protection, and:
  1. copies the files on disk to a directory outside the working tree;
  2. applies the patch there, with no fuzz;
  3. runs only the tests named for that protection, against a database of
     its own;
  4. requires every named test to have run and failed, with a failure message
     that contains the stated text;
  5. removes the copy.
- **A sabotage counts as caught only by its named tests.** A named test that
  passed, did not run, or failed for another reason fails the row. So does a
  patch that no longer applies.
- **The named tests must pass with no patch first.** A test that is already
  red would otherwise count as a catch.
- **Drift is caught early.** The normal test run checks that every patch
  still applies to the code as it is (`test/prove/manifest.spec.ts`).
- **The runner changes nothing in the repository.** It reads the list of
  files from git and does everything else in the copies.
- **The data model document is generated,** and a test fails when the
  committed file differs from what the migrated database generates
  (`db/data-model.ts`, `test/db/data-model.spec.ts`).

## Alternatives considered

- **Mocks or an in-memory database.** Row-level security, deferred triggers,
  advisory locks and column grants are the protections. Nothing but
  PostgreSQL has them.
- **Tests as a superuser or as the owner.** A superuser bypasses row-level
  security, so every isolation test would pass for the wrong reason.
- **A mutation testing tool.** It mutates everything it can parse, runs for
  hours, and does not know which mutation removes a protection. It also
  cannot mutate SQL migrations, where most of the protections are. We chose a
  short list of sabotages, each with the tests that must catch it.
- **Trusting that a failing test failed for the right reason.** A sabotaged
  migration can break the seed, and then every test fails without any of
  them having run. The runner reads each named test's own result and message.
- **Applying the patch in the working tree and reverting it.** A crash
  between the two leaves a protection removed in the tree someone is working
  in.
- **Running the sabotages on every pull request.** The full run is long. It
  is a workflow that is started by hand, and the check that every patch
  still applies runs on every pull request.

## Consequences

- A protection that loses its tests, or a test that stops testing it, turns a
  row of `pnpm prove` to failed.
- A change to protected code must keep its sabotage applying, or update the
  patch in the same pull request.
- The full run takes minutes, not seconds, and needs Docker.

## Known limits

- The list is hand-picked. A protection without a sabotage is covered by its
  tests only.
- A sabotage shows that the named tests catch one way of removing a
  protection, not every way.
- The expected text of a failure is part of the manifest. A reworded
  assertion needs the manifest updated.
- The browser sabotages build both applications and use fixed ports, so they
  run one at a time and cannot run beside the browser tests.
- The dependencies of the copies come from one offline install per run, made
  from the package store the repository's own install filled.

## Evidence

- Pull requests: [#1](https://github.com/josamcode/school-tenancy-spike/pull/1)
  for the database in tests, and the pull request that adds `pnpm prove`.
- The runner, on a small project of its own, including a sabotage that breaks
  nothing, one that breaks another test, one that stops the test from
  running, a wrong reason, a drifted patch and a red baseline:
  `test/prove/prove.spec.ts`.
- The manifest: `test/prove/manifest.spec.ts`.
- Roles and reach, as the runtime role: `test/db/role.spec.ts`,
  `test/db/reach.spec.ts`.
- The workflow: `.github/workflows/prove.yml`.
