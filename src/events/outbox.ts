import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { TenantDb } from '../db/tenant-db.js';
import { EventPayloads, EventType } from './event-types.js';

// Writes an event in the caller's tenant transaction, so it commits or rolls
// back with whatever caused it. There is no other way to emit one.
@Injectable()
export class Outbox {
  constructor(private readonly tenantDb: TenantDb) {}

  async emit<T extends EventType>(
    type: T,
    payload: EventPayloads[T],
  ): Promise<string> {
    const { rows } = await this.tenantDb.db.execute<{ id: string }>(sql`
      insert into outbox_events (type, payload)
      values (${type}, ${JSON.stringify(payload)}::jsonb)
      returning id`);
    return rows[0].id;
  }
}
