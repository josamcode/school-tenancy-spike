import { Inject, Injectable } from '@nestjs/common';
import pg from 'pg';
import { PG_POOL } from './pg-pool.js';

@Injectable()
export class DbHealth {
  constructor(@Inject(PG_POOL) private readonly pool: pg.Pool) {}

  // Touches no table, so it needs no tenant.
  async ping(): Promise<void> {
    await this.pool.query('select 1');
  }
}
