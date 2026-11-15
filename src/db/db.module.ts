import { Inject, Module, OnApplicationShutdown } from '@nestjs/common';
import pg from 'pg';
import { DbHealth } from './db-health.js';
import { PG_POOL } from './pg-pool.js';
import { TenantDb } from './tenant-db.js';

// The pool is not exported: other modules reach the database through TenantDb.
@Module({
  providers: [
    {
      provide: PG_POOL,
      useFactory: () => {
        const connectionString = process.env.DATABASE_URL;
        if (!connectionString) throw new Error('DATABASE_URL is not set');
        return new pg.Pool({ connectionString });
      },
    },
    TenantDb,
    DbHealth,
  ],
  exports: [TenantDb, DbHealth],
})
export class DbModule implements OnApplicationShutdown {
  constructor(@Inject(PG_POOL) private readonly pool: pg.Pool) {}

  async onApplicationShutdown() {
    await this.pool.end();
  }
}
