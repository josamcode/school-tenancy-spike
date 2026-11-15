import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module.js';
import { CoreModule } from './core/core.module.js';
import { HealthModule } from './health/health.module.js';

@Module({
  imports: [AuthModule, HealthModule, CoreModule],
})
export class AppModule {}
