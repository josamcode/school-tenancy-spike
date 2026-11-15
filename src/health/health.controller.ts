import { Controller, Get } from '@nestjs/common';
import { Public } from '../auth/public.decorator.js';
import { DbHealth } from '../db/db-health.js';

@Controller('health')
export class HealthController {
  constructor(private readonly dbHealth: DbHealth) {}

  @Public()
  @Get()
  async check() {
    await this.dbHealth.ping();
    return { status: 'ok', db: 'up' };
  }
}
