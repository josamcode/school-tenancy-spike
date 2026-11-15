# 8. Delivery: routing decided once, idempotent handlers, dead letters and signed webhooks

## Context

An accepted student's event goes to one of two places. If the school has the
finance module, finance posts a registration fee. If not, the school's own
system is told through a webhook. Delivery is at least once, a module can be
switched while an event is waiting, an endpoint can be down for hours, and a
handler can keep failing. None of these may charge a student twice, charge
and notify, or lose the event without a trace.

## Decision

- **The route is decided at delivery, once.** The module has to be checked at
  delivery anyway, so a route fixed at emission would be a second decision
  that can disagree. The state at delivery wins. After the decision, a switch
  changes nothing for that event (`src/events/event-runner.ts`).
- **The decision is read under a lock that a switch also takes.** A trigger on
  `tenant_modules` takes an advisory lock exclusively on every insert, update
  and delete, so every writer takes it by construction. Delivery takes it
  shared before it reads whether the module is on.
- **One handler per event is a database guarantee.** The key of
  `processed_events` is the school and the event. The runner writes that row,
  not the handler, in the same transaction as the handler's effect. A second
  run finds the decision and does nothing more.
- **The webhook handoff survives a crash.** The routing transaction commits,
  then the delivery job is sent. Every run of an events job whose decision is
  the webhook and whose delivery is still pending sends the delivery job
  again, under the event's id.
- **No transaction is open during the HTTP call.** The sender reads the
  endpoint in one short transaction, sends with a 5 second timeout, and
  records the attempt in a second one (`src/events/webhook-sender.ts`). A slow
  endpoint holds no connection and no lock.
- **Failure is recorded in the school's own tables.** Both queues have a
  dead-letter queue. A delivery that has used its retries is marked failed in
  `webhook_deliveries`. An event whose handler keeps failing gets one row in
  `event_failures`, in the event's school, with the last error.
- **Final states are final by policy.** The update policy on
  `webhook_deliveries` matches pending rows only.
- **Webhooks follow the Standard Webhooks scheme**
  (`src/events/webhook-signature.ts`). `webhook-id` is the event id and the
  receiver's idempotency key, the same on every attempt. `webhook-timestamp`
  is the send time. `webhook-signature` is an HMAC-SHA256 over the id, the
  timestamp and the exact body, keyed with the school's own secret. A school
  can verify it with an existing library.
- **The fee is dated by the acceptance, in the school's timezone.** The event
  carries the instant in UTC and the handler converts it in SQL with
  `tenants.timezone`, which must be an IANA name.

## Alternatives considered

- **Fixing the route when the event is emitted.** It reads better in a log.
  It is also wrong whenever the module is switched before delivery, and it
  needs the module check a second time anyway.
- **Letting each handler record that it ran.** A handler can forget, or
  record in a different transaction than its effect.
- **Trusting the queue for exactly-once.** No queue gives that across a crash
  between an effect and its acknowledgement. The key in `processed_events`
  does.
- **Sending the webhook inside the transaction that records it.** An endpoint
  that hangs would hold a connection and its locks until the timeout.
- **Leaving a failed job in the queue's schema.** No application role reads
  that schema, and the queue deletes old jobs. A school with finance on and a
  fee that cannot be posted would accept students and never charge them, and
  nothing in its own tables would show it.
- **A signature scheme of our own.** A receiver would need our code or our
  description to verify it.

## Consequences

- An event ends in exactly one of: handled by a module, delivered, failed
  delivery, or failed event. Each is a row the school can read.
- A replayed webhook is recognised by its id, and a changed body or timestamp
  fails the signature.
- A handler's effect and its `processed_events` row cannot disagree.

## Known limits

- The webhook secret is stored in plain text and the runtime role can read it
  in its school.
- Endpoint addresses are not checked against internal addresses.
- Nothing redrives a failed event or a failed delivery, and nothing removes
  an `event_failures` row.
- A dead-letter job that cannot record its failure, because the event is not
  visible in the job's school, is logged and stays failed in the queue's
  schema. That is the one case that is not in the application's tables.
- Job expiry, the queue's own way to fail a job whose worker died, takes at
  least a minute and is stood in for by failing the job in three tests.
- The request-time module check does not take the module lock.

## Evidence

- Pull request: [#6](https://github.com/josamcode/school-tenancy-spike/pull/6).
- Routing, including a switch that has not committed: `test/events/routing.spec.ts`.
- The same event delivered twice, at the same moment, and after a worker
  died: `test/events/idempotency.spec.ts`.
- Signatures, retries with backoff, a failed delivery, a crash before the
  handoff, and an endpoint that hangs: `test/events/webhook.spec.ts`,
  `src/events/webhook-signature.spec.ts`.
- An event whose handler keeps failing: `test/events/failed-events.spec.ts`.
- The fee's date: `test/events/fee-date.spec.ts`.
- From the accept route to a receiver, with every process running:
  `test/events/dispatch.e2e-spec.ts`, `web/e2e/events.spec.ts`.
- `pnpm prove` rows: `events.no-processed-check`,
  `events.route-without-module-lock`, `events.no-delivery-resend`,
  `events.no-dead-letter`, `events.unsigned-timestamp`.
