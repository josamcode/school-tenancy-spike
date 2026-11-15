# 7. Events: an outbox in the acceptance transaction, a dispatcher and a queue under its own role

## Context

Accepting a student has effects outside admissions: finance charges a
registration fee, or the school's own system is told. A module must not call
another module's tables. And the effect must neither be lost when the
acceptance commits, nor happen when the acceptance rolls back.

The queue we use keeps its jobs in PostgreSQL tables of its own, outside the
`public` schema and without row-level security.

## Decision

- **The event is a row written in the transaction that causes it.** Accepting
  an application locks it, creates the student, marks it accepted and inserts
  a `student.accepted` row into `outbox_events`, all in the request's
  transaction (`src/admissions/admissions.service.ts`, `src/events/outbox.ts`).
  There is no other way to emit an event.
- **The outbox is append-only by privilege.** The runtime role may select, and
  may insert `type` and `payload` only. The school, the actor and the time
  come from the transaction. It cannot write an event that is already marked
  dispatched, and no role has `DELETE`.
- **A dispatcher copies committed events into the queue**
  (`src/events/dispatcher.ts`). It connects as `app_dispatcher`, which can
  read four columns of the outbox across schools and set one. It cannot read
  a payload, a type or an actor.
- **Send first, mark second.** A crash between the two sends the event again.
  The job id is the event id, and the queue ignores a second job with the
  same id while it keeps the first.
- **A job carries the event id and the school id, and nothing else.** The
  payload stays under the school's row-level security.
- **The school of a job is confirmed by the event row.** `TenantDb.runForEvent`
  sets the school from the job, then loads the event under row-level security.
  A job that names the wrong school finds nothing and the handler never runs.
- **The handler runs as the user who caused the event,** read from the row.
  Their membership is not checked again: the acceptance was authorised when
  it committed, and a later revocation must not strand it.
- **The queue runs as `app_queue`** in the `pgboss` schema and reaches no
  application table. The queue library installs and upgrades its own tables.
- **Handlers declare what they handle,** as routes declare permissions:
  `@HandlesEvent(type, area)`. The worker refuses to start on an unknown event
  type, an undeclared area, or two handlers for one event.
- **Modules meet only through events.** Admissions reads no finance table.
  The fee is posted by finance's own handler.

## Alternatives considered

- **Enqueueing the job inside the acceptance transaction.** It is the
  shortest path. It runs the queue's SQL on the runtime role's connection, so
  that role would need rights on tables outside `public` with no row-level
  security, and could enqueue a job for any school. It breaks the reach rule
  (see [decision 2](0002-the-reach-rule-and-roles.md)).
- **Publishing to a broker after the commit.** A crash between the commit and
  the publish loses the event, and nothing records that it was owed.
- **Calling finance from admissions.** It couples the two modules and makes
  the acceptance fail when finance fails, or when finance is switched off.
- **A dispatcher with `BYPASSRLS`, or a definer function.** Both give more
  than "which event belongs to which school". Two policies on named columns
  give exactly that, and a test can list the whole path.
- **Pasting the queue's DDL into our migrations.** It would be a hand-kept
  copy that must match every upgrade of the library.

## Consequences

- An acceptance and its event commit or roll back together.
- Delivery is at least once. Handlers must be idempotent (see
  [decision 8](0008-delivery.md)).
- Nothing personal enters the queue's schema.
- The worker is a second process with three connections, one per role.

## Known limits

- The queue ignores a duplicate job id only while it keeps the first job. A
  re-send after that creates a job, and the handler's idempotency is what
  protects the effect.
- There is one event type and one handler per event. A second module that
  consumes the same event needs a consumer column that is not built.
- Delivery order is not guaranteed, and there is no per-school limit on
  worker concurrency.
- `RouteDeclarations` sees HTTP routes only. Event handlers have their own
  start-up check.

## Evidence

- Pull request: [#6](https://github.com/josamcode/school-tenancy-spike/pull/6).
- One transaction for the acceptance and its event, and two accepts that
  overlap: `test/admissions/accept-transaction.spec.ts`,
  `test/api/admissions.e2e-spec.ts`.
- What each role can do with the outbox: `test/db/event-roles.spec.ts`,
  `test/db/event-tables.spec.ts`.
- The dispatcher, including a crash between the send and the mark:
  `test/events/dispatch.e2e-spec.ts`.
- A handler runs with the event's school and actor, and never for a job that
  names another school: `test/events/isolation.spec.ts`.
- Handler declarations: `test/events/declarations.spec.ts`.
- `pnpm prove` rows: `events.event-own-transaction`,
  `events.accept-no-row-lock`.
