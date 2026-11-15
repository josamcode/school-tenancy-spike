import { Inject, Module, OnApplicationShutdown } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import pg from 'pg';
import { DbHealth } from './db-health.js';
import { PG_POOL } from './pg-pool.js';
import { TenantDb } from './tenant-db.js';
import { TenantInterceptor } from './tenant.interceptor.js';

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
    { provide: APP_INTERCEPTOR, useClass: TenantInterceptor },
  ],
  exports: [TenantDb, DbHealth],
})
export class DbModule implements OnApplicationShutdown {
  constructor(@Inject(PG_POOL) private readonly pool: pg.Pool) {}

  async onApplicationShutdown() {
    await this.pool.end();
  }
}
