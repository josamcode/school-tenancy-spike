import { Injectable, Logger } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import { tenantModules } from '../core/core.schema.js';
import { TenantDb } from '../db/tenant-db.js';
import { Area, AREAS } from '../entitlements/areas.js';
import { EventHandlers } from './event-handlers.js';
import { EventQueue } from './event-queue.js';
import { EventRef } from './event-types.js';
import { lockModuleShared } from './module-lock.js';

const WEBHOOK = 'webhook';
const MAX_ERROR_LENGTH = 2000;

// Runs one events job. It decides once, at delivery, whether the module's
// handler or the webhook takes the event, and records the decision in the
// same transaction as the handler's effect. A second run finds the decision
// and follows it.
@Injectable()
export class EventRunner {
  private readonly logger = new Logger(EventRunner.name);

  constructor(
    private readonly tenantDb: TenantDb,
    private readonly handlers: EventHandlers,
    private readonly queue: EventQueue,
  ) {}

  async handle(ref: EventRef): Promise<void> {
    const owesDelivery = await this.tenantDb.runForEvent(ref, async (event) => {
      const db = this.tenantDb.db;
      const handler = this.handlers.for(event.type);

      let decided = await this.decisionOf(event.id);
      if (decided === undefined) {
        // The module is read under its lock, so a switch either commits
        // before this read or waits until this transaction ends.
        const target =
          handler && (await this.moduleOn(handler.area))
            ? handler.area
            : WEBHOOK;
        const claimed = await db.execute(sql`
          insert into processed_events (event_id, handler)
          values (${event.id}, ${target})
          on conflict do nothing`);
        if (claimed.rowCount === 1) {
          if (target === WEBHOOK) {
            await db.execute(
              sql`insert into webhook_deliveries (event_id) values (${event.id})`,
            );
          } else {
            await handler!.instance.handle(event);
          }
          decided = target;
        } else {
          // Another run of this job decided first and has committed.
          decided = await this.decisionOf(event.id);
        }
      }

      if (decided !== WEBHOOK) return false;
      const delivery = await db.execute<{ status: string }>(
        sql`select status from webhook_deliveries where event_id = ${event.id}`,
      );
      return delivery.rows[0]?.status === 'pending';
    });

    // Outside the transaction, on the queue's own connection. A crash before
    // this line leaves a pending delivery with no job, so every run sends it
    // again until the delivery is no longer pending. The job is keyed by the
    // event id and cannot be duplicated. If the send fails, this job fails
    // and is retried.
    if (owesDelivery) await this.queue.sendDelivery(ref);
  }

  // Runs for an events job that has used all its retries. The failure is
  // written under the event's own school, once, so the school can see an
  // event that nothing handled. If the event is not visible in the job's
  // school there is no school to record it under: it is logged and this
  // dead-letter job fails.
  async recordFailure(ref: EventRef, error: string): Promise<void> {
    try {
      await this.tenantDb.runForEvent(ref, async (event) => {
        await this.tenantDb.db.execute(sql`
          insert into event_failures (event_id, error)
          values (${event.id}, ${error.slice(0, MAX_ERROR_LENGTH)})
          on conflict do nothing`);
      });
    } catch (cause) {
      const reason = cause instanceof Error ? cause.message : String(cause);
      this.logger.error(
        `Could not record the failure of event ${ref.eventId} in school ${ref.tenantId} (${error}): ${reason}`,
      );
      throw cause;
    }
  }

  private async decisionOf(eventId: string): Promise<string | undefined> {
    const { rows } = await this.tenantDb.db.execute<{ handler: string }>(
      sql`select handler from processed_events where event_id = ${eventId}`,
    );
    return rows[0]?.handler;
  }

  private async moduleOn(area: Area): Promise<boolean> {
    if (AREAS[area] === 'core') return true;
    const db = this.tenantDb.db;
    await db.execute(lockModuleShared(area));
    const rows = await db
      .select({ module: tenantModules.module })
      .from(tenantModules)
      .where(
        and(eq(tenantModules.module, area), eq(tenantModules.enabled, true)),
      );
    return rows.length === 1;
  }
}
