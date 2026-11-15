import { Inject, Injectable } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import { TenantDb } from '../db/tenant-db.js';
import { EventRef, OutboxEvent } from './event-types.js';
import { webhookDeliveries, webhookEndpoints } from './events.schema.js';
import { signWebhook } from './webhook-signature.js';
import { WORKER_CONFIG } from './worker.config.js';
import type { WorkerConfig } from './worker.config.js';

interface Outcome {
  startedAt: Date;
  status: number | null;
  error: string | null;
}

// Sends one delivery attempt. The database work is two short transactions
// with the HTTP request between them, so a slow endpoint holds no connection
// and no lock.
@Injectable()
export class WebhookSender {
  constructor(
    private readonly tenantDb: TenantDb,
    @Inject(WORKER_CONFIG) private readonly config: WorkerConfig,
  ) {}

  // Resolves when there is nothing left to do. Rejects when the attempt
  // failed, so the queue retries the job with backoff.
  async deliver(ref: EventRef): Promise<void> {
    const prepared = await this.tenantDb.runForEvent(ref, async (event) => {
      const db = this.tenantDb.db;
      const [delivery] = await db
        .select({ status: webhookDeliveries.status })
        .from(webhookDeliveries)
        .where(eq(webhookDeliveries.eventId, event.id));
      if (delivery?.status !== 'pending') return null;
      const [endpoint] = await db
        .select({ url: webhookEndpoints.url, secret: webhookEndpoints.secret })
        .from(webhookEndpoints);
      return { event, endpoint: endpoint as typeof endpoint | undefined };
    });
    if (!prepared) return;

    const outcome: Outcome = prepared.endpoint
      ? await this.post(ref, prepared.event, prepared.endpoint)
      : {
          startedAt: new Date(),
          status: null,
          error: 'No webhook endpoint is configured',
        };
    const delivered =
      outcome.status !== null && outcome.status >= 200 && outcome.status < 300;

    await this.tenantDb.runForEvent(ref, async (event) => {
      const db = this.tenantDb.db;
      // The row lock keeps two runs of this job from taking the same number.
      await db.execute(sql`
        select 1 from webhook_deliveries where event_id = ${event.id} for update`);
      await db.execute(sql`
        insert into webhook_attempts
          (event_id, attempt_no, started_at, response_status, error)
        select ${event.id}::uuid, coalesce(max(attempt_no), 0) + 1,
               ${outcome.startedAt.toISOString()}::timestamptz,
               ${outcome.status}::integer, ${outcome.error}::text
          from webhook_attempts where event_id = ${event.id}`);
      if (delivered) {
        await db.execute(sql`
          update webhook_deliveries
             set status = 'delivered', finished_at = now()
           where event_id = ${event.id} and status = 'pending'`);
      }
    });

    if (!delivered) {
      throw new Error(
        `Webhook delivery of event ${ref.eventId} failed: ${
          outcome.error ?? `HTTP ${outcome.status}`
        }`,
      );
    }
  }

  // Runs for a job that has used all its retries, however it failed.
  async markFailed(ref: EventRef): Promise<void> {
    await this.tenantDb.runForEvent(ref, async (event) => {
      await this.tenantDb.db.execute(sql`
        update webhook_deliveries
           set status = 'failed', finished_at = now()
         where event_id = ${event.id} and status = 'pending'`);
    });
  }

  private async post(
    ref: EventRef,
    event: OutboxEvent,
    endpoint: { url: string; secret: string },
  ): Promise<Outcome> {
    const { timeoutMs } = this.config.webhook;
    const startedAt = new Date();
    const body = JSON.stringify({
      id: event.id,
      type: event.type,
      schoolId: ref.tenantId,
      occurredAt: event.createdAt.toISOString(),
      data: event.payload,
    });
    const timestamp = Math.floor(startedAt.getTime() / 1000);
    try {
      const response = await fetch(endpoint.url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          // The same on every attempt: the receiver's idempotency key.
          'webhook-id': event.id,
          'webhook-timestamp': String(timestamp),
          'webhook-signature': signWebhook({
            secret: endpoint.secret,
            id: event.id,
            timestamp,
            body,
          }),
        },
        body,
        redirect: 'manual',
        signal: AbortSignal.timeout(timeoutMs),
      });
      await response.body?.cancel();
      return { startedAt, status: response.status, error: null };
    } catch (error) {
      const timedOut = error instanceof Error && error.name === 'TimeoutError';
      const message = error instanceof Error ? error.message : String(error);
      return {
        startedAt,
        status: null,
        error: timedOut ? `Timed out after ${timeoutMs}ms` : message,
      };
    }
  }
}
