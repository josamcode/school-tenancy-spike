import { Inject, Injectable, OnApplicationShutdown } from '@nestjs/common';
import pg from 'pg';
import { EventQueue } from './event-queue.js';
import { WORKER_CONFIG } from './worker.config.js';
import type { WorkerConfig } from './worker.config.js';

const BATCH = 100;

// Copies committed events from the outbox into the queue. It connects as the
// dispatcher role, the only one that reads across schools, and all it can
// read is which event belongs to which school.
@Injectable()
export class Dispatcher implements OnApplicationShutdown {
  private readonly pool: pg.Pool;

  constructor(
    @Inject(WORKER_CONFIG) config: WorkerConfig,
    private readonly queue: EventQueue,
  ) {
    this.pool = new pg.Pool({ connectionString: config.dispatcherUrl, max: 1 });
  }

  async onApplicationShutdown() {
    await this.pool.end();
  }

  // Sends first and marks second. A crash between the two leaves the event
  // unmarked, and the next pass sends it again under the same job id.
  async dispatchOnce(): Promise<number> {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      const { rows } = await client.query<{ id: string; tenant_id: string }>(
        `select id, tenant_id from outbox_events
          where dispatched_at is null
          order by created_at
          limit $1
          for update skip locked`,
        [BATCH],
      );
      for (const row of rows) {
        await this.queue.sendEvent({
          eventId: row.id,
          tenantId: row.tenant_id,
        });
      }
      if (rows.length > 0) {
        // By school and id, which is the table's key.
        await client.query(
          `update outbox_events set dispatched_at = now()
            where (tenant_id, id) in
                  (select * from unnest($1::uuid[], $2::uuid[]))`,
          [rows.map((row) => row.tenant_id), rows.map((row) => row.id)],
        );
      }
      await client.query('commit');
      return rows.length;
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }
}
