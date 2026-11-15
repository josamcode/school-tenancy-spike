import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module.js';
import { CoreModule } from './core/core.module.js';
import { EntitlementsModule } from './entitlements/entitlements.module.js';
import { HealthModule } from './health/health.module.js';

@Module({
  imports: [
    AuthModule,
    EntitlementsModule,
    HealthModule,
    CoreModule,
  ],
})
export class AppModule {}
