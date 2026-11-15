import { Module } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard.js';
import { DbModule } from '../db/db.module.js';
import { TenantInterceptor } from '../db/tenant.interceptor.js';
import { StudentsController } from './students.controller.js';

@Module({
  imports: [DbModule],
  controllers: [StudentsController],
  providers: [AuthGuard, TenantInterceptor],
})
export class CoreModule {}
