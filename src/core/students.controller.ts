import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
} from '@nestjs/common';
import { TenantDb } from '../db/tenant-db.js';
import { RequiresPermission } from '../entitlements/decorators.js';
import { students } from './core.schema.js';

@Controller('schools/:schoolId/students')
export class StudentsController {
  constructor(private readonly tenantDb: TenantDb) {}

  @Get()
  @RequiresPermission('students:read')
  list() {
    return this.tenantDb.db.select().from(students);
  }

  @Post()
  @RequiresPermission('students:create')
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
