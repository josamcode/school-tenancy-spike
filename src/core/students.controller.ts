import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard.js';
import { TenantDb } from '../db/tenant-db.js';
import { TenantInterceptor } from '../db/tenant.interceptor.js';
import { students } from './core.schema.js';

@Controller('schools/:schoolId/students')
@UseGuards(AuthGuard)
@UseInterceptors(TenantInterceptor)
export class StudentsController {
  constructor(private readonly tenantDb: TenantDb) {}

  @Get()
  list() {
    return this.tenantDb.db.select().from(students);
  }

  @Post()
  async create(@Body() body: { fullName?: unknown }) {
    const fullName = body?.fullName;
    if (typeof fullName !== 'string' || fullName.trim() === '') {
      throw new BadRequestException('fullName is required');
    }
    const [student] = await this.tenantDb.db
      .insert(students)
      .values({ fullName })
      .returning();
    return student;
  }
}
