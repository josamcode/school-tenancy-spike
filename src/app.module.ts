import { Module } from '@nestjs/common';
import { CoreModule } from './core/core.module.js';
import { HealthModule } from './health/health.module.js';

@Module({
  imports: [HealthModule, CoreModule],
})
export class AppModule {}
