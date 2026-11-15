import { Controller, Get, Inject } from '@nestjs/common';
import pg from 'pg';
import { PG_POOL } from '../db/db.module.js';

@Controller('health')
export class HealthController {
  constructor(@Inject(PG_POOL) private readonly pool: pg.Pool) {}

  @Get()
  async check() {
    await this.pool.query('select 1');
    return { status: 'ok', db: 'up' };
  }
}
