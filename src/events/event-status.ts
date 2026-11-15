import { Injectable } from '@nestjs/common';
import { SQL, sql } from 'drizzle-orm';
import { TenantDb } from '../db/tenant-db.js';
import { EventType } from './event-types.js';

export interface EventStatusView {
  event: {
    id: string;
    type: string;
    createdAt: string;
    dispatchedAt: string | null;
  };
  // Which handler took the event, once one has.
  routedTo: string | null;
  routedAt: string | null;
  delivery: {
    status: string;
    url: string | null;
    finishedAt: string | null;
    attempts: {
      attemptNo: number;
      startedAt: string;
      responseStatus: number | null;
      error: string | null;
    }[];
  } | null;
  failure: { failedAt: string; error: string } | null;
}

interface EventRow extends Record<string, unknown> {
  id: string;
  type: string;
  created_at: string;
  dispatched_at: string | null;
  handler: string | null;
  processed_at: string | null;
  delivery_status: string | null;
  finished_at: string | null;
  failed_at: string | null;
  failure: string | null;
}

interface AttemptRow extends Record<string, unknown> {
  attempt_no: number;
  started_at: string;
  response_status: number | null;
  error: string | null;
}

// An instant as text, in UTC, the way JSON carries it.
export const utc = (instant: SQL) =>
  sql`to_char(${instant} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;

// Reads what became of an event. Must be called inside a tenant transaction,
// so it finds only the events of that school.
@Injectable()
export class EventStatus {
  constructor(private readonly tenantDb: TenantDb) {}

  // The newest event of a type whose payload names the subject under key.
  async find(
    type: EventType,
    key: string,
    subject: string,
  ): Promise<EventStatusView | undefined> {
    const db = this.tenantDb.db;
    const found = await db.execute<EventRow>(sql`
      select e.id, e.type,
             ${utc(sql`e.created_at`)} as created_at,
             ${utc(sql`e.dispatched_at`)} as dispatched_at,
             p.handler,
             ${utc(sql`p.processed_at`)} as processed_at,
             d.status as delivery_status,
             ${utc(sql`d.finished_at`)} as finished_at,
             ${utc(sql`f.failed_at`)} as failed_at,
             f.error as failure
        from outbox_events e
        left join processed_events p
               on p.tenant_id = e.tenant_id and p.event_id = e.id
        left join webhook_deliveries d
               on d.tenant_id = e.tenant_id and d.event_id = e.id
        left join event_failures f
               on f.tenant_id = e.tenant_id and f.event_id = e.id
       where e.type = ${type} and e.payload ->> ${key} = ${subject}
       order by e.created_at desc
       limit 1`);
    const row = found.rows[0];
    if (!row) return undefined;

    return {
      event: {
        id: row.id,
        type: row.type,
        createdAt: row.created_at,
        dispatchedAt: row.dispatched_at,
      },
      routedTo: row.handler,
      routedAt: row.processed_at,
      delivery:
        row.delivery_status === null
          ? null
          : {
              status: row.delivery_status,
              url: await this.endpointUrl(),
              finishedAt: row.finished_at,
              attempts: await this.attemptsOf(row.id),
            },
      failure:
        row.failed_at === null || row.failure === null
          ? null
          : { failedAt: row.failed_at, error: row.failure },
    };
  }

  // The address only. The endpoint's secret is never read here.
  private async endpointUrl(): Promise<string | null> {
    const { rows } = await this.tenantDb.db.execute<{ url: string }>(
      sql`select url from webhook_endpoints`,
    );
    return rows[0]?.url ?? null;
  }

  private async attemptsOf(eventId: string) {
    const { rows } = await this.tenantDb.db.execute<AttemptRow>(sql`
      select attempt_no, ${utc(sql`started_at`)} as started_at,
             response_status, error
        from webhook_attempts
       where event_id = ${eventId}
       order by attempt_no`);
    return rows.map((row) => ({
      attemptNo: row.attempt_no,
      startedAt: row.started_at,
      responseStatus: row.response_status,
      error: row.error,
    }));
  }
}
