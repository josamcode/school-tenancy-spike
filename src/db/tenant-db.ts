import { AsyncLocalStorage } from 'node:async_hooks';
import { ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import type { EventRef, OutboxEvent } from '../events/event-types.js';
import { PG_POOL } from './pg-pool.js';

const ENDED = 'The tenant transaction has ended';

interface TenantTransaction {
  db: NodePgDatabase;
  state: { ended: boolean };
}

interface EventRow {
  id: string;
  type: string;
  payload: unknown;
  actor_user_id: string;
  created_at: Date;
}

@Injectable()
export class TenantDb {
  private readonly current = new AsyncLocalStorage<TenantTransaction>();

  constructor(@Inject(PG_POOL) private readonly pool: pg.Pool) {}

  get db(): NodePgDatabase {
    const transaction = this.current.getStore();
    if (!transaction) {
      throw new Error('Database access outside a tenant transaction');
    }
    if (transaction.state.ended) throw new Error(ENDED);
    return transaction.db;
  }

  // For a request. Sets app.tenant_id only after the user's access to the
  // school is confirmed.
  run<T>(userId: string, schoolId: string, fn: () => Promise<T>): Promise<T> {
    return this.transaction(async (client) => {
      await client.query("select set_config('app.user_id', $1, true)", [
        userId,
      ]);
      // A membership or at least one grant in this school. Anything else,
      // an unknown school included, gets the same answer.
      const access = await client.query(
        `select 1 from memberships where user_id = $1 and tenant_id = $2
         union all
         select 1 from grants where user_id = $1 and tenant_id = $2
         limit 1`,
        [userId, schoolId],
      );
      if (access.rowCount !== 1) throw new ForbiddenException();
      await client.query("select set_config('app.tenant_id', $1, true)", [
        schoolId,
      ]);
    }, fn);
  }

  // For a route with no school in its path. Sets the user and never a
  // school, so every policy that looks at the school matches nothing. What is
  // left to read is the user's own row, memberships and grants.
  runForUser<T>(userId: string, fn: () => Promise<T>): Promise<T> {
    return this.transaction(async (client) => {
      await client.query("select set_config('app.user_id', $1, true)", [
        userId,
      ]);
    }, fn);
  }

  // For an event handler. The school comes from the job, and the event must
  // then be visible under that school's row-level security: a job that names
  // the wrong school finds nothing and fn never runs. The user is the one who
  // caused the event, read from its row. Their membership is not checked
  // again, because the event was authorised when it was committed.
  runForEvent<T>(
    ref: EventRef,
    fn: (event: OutboxEvent) => Promise<T>,
  ): Promise<T> {
    let event: OutboxEvent;
    return this.transaction(
      async (client) => {
        await client.query("select set_config('app.tenant_id', $1, true)", [
          ref.tenantId,
        ]);
        const found = await client.query<EventRow>(
          `select id, type, payload, actor_user_id, created_at
             from outbox_events where id = $1`,
          [ref.eventId],
        );
        if (found.rowCount !== 1) {
          throw new Error(
            `Event ${ref.eventId} is not in school ${ref.tenantId}`,
          );
        }
        const row = found.rows[0];
        await client.query("select set_config('app.user_id', $1, true)", [
          row.actor_user_id,
        ]);
        event = {
          id: row.id,
          type: row.type,
          payload: row.payload,
          actorUserId: row.actor_user_id,
          createdAt: row.created_at,
        };
      },
      () => fn(event),
    );
  }

  // The only code that opens a transaction for the application. enter decides
  // the user and whether a school is set, and throws to refuse.
  private async transaction<T>(
    enter: (client: pg.PoolClient) => Promise<void>,
    fn: () => Promise<T>,
  ): Promise<T> {
    const client = await this.pool.connect();
    const state = { ended: false };
    let destroy = false;
    // A checked-out client has no error listener, so a connection lost
    // mid-transaction would otherwise crash the process.
    const onConnectionError = () => {
      destroy = true;
    };
    client.on('error', onConnectionError);
    // A released connection is reused by other requests, so a handle kept
    // past the end of its transaction must fail instead of querying it.
    const guarded = new Proxy(client, {
      get(target, property) {
        if (state.ended) throw new Error(ENDED);
        const value = Reflect.get(target, property, target);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });

    try {
      await client.query('begin');
      await enter(client);
      const result = await this.current.run(
        { db: drizzle(guarded), state },
        fn,
      );
      await client.query('commit');
      return result;
    } catch (error) {
      try {
        await client.query('rollback');
      } catch {
        // The connection may still be inside the transaction with the tenant
        // set, so it must be destroyed, not handed to the next request.
        destroy = true;
      }
      throw error;
    } finally {
      state.ended = true;
      client.off('error', onConnectionError);
      client.release(destroy);
    }
  }
}
