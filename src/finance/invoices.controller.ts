import { Controller, Get } from '@nestjs/common';
import { TenantDb } from '../db/tenant-db.js';
import { RequiresModule } from '../entitlements/decorators.js';
import { invoices } from './finance.schema.js';

@Controller('schools/:schoolId/invoices')
@RequiresModule('finance')
export class InvoicesController {
  constructor(private readonly tenantDb: TenantDb) {}

  @Get()
  list() {
    return this.tenantDb.db.select().from(invoices);
  }
}
