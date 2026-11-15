import { AsyncLocalStorage } from 'node:async_hooks';
import { ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { PG_POOL } from './pg-pool.js';

const ENDED = 'The tenant transaction has ended';

interface TenantTransaction {
  db: NodePgDatabase;
  state: { ended: boolean };
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

  // The only place that sets app.tenant_id, and only after the user's access to the school is confirmed.
  async run<T>(
    userId: string,
    schoolId: string,
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
