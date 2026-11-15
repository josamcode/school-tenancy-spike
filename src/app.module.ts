import { Module } from '@nestjs/common';
import { AdmissionsModule } from './admissions/admissions.module.js';
import { AuthModule } from './auth/auth.module.js';
import { CoreModule } from './core/core.module.js';
import { EntitlementsModule } from './entitlements/entitlements.module.js';
import { FinanceModule } from './finance/finance.module.js';
import { HealthModule } from './health/health.module.js';

@Module({
  imports: [
    AuthModule,
    EntitlementsModule,
    HealthModule,
    CoreModule,
    FinanceModule,
    AdmissionsModule,
  ],
})
export class AppModule {}
