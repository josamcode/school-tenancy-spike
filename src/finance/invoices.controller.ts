import {
  BadRequestException,
  Controller,
  Get,
  NotFoundException,
  Param,
} from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { HijriCalendar } from '../calendar/hijri-calendar.js';
import { isUuid } from '../common/uuid.js';
import { I18nText } from '../db/i18n-text.js';
import { TenantDb } from '../db/tenant-db.js';
import { RequiresPermission } from '../entitlements/decorators.js';
import { invoices } from './finance.schema.js';
import { fromMinor, isCurrency, toMinor } from './money.js';

interface InvoiceRow extends Record<string, unknown> {
  id: string;
  number: string;
  amount: string;
  currency: string;
  description: I18nText | null;
  issue_date: string;
  due_date: string | null;
  student_name: string;
  school_name: string;
  school_name_i18n: I18nText | null;
}

@Controller('schools/:schoolId/invoices')
@RequiresPermission('finance:read')
export class InvoicesController {
  constructor(
    private readonly tenantDb: TenantDb,
    private readonly calendar: HijriCalendar,
  ) {}

  @Get()
  list() {
    return this.tenantDb.db.select().from(invoices);
  }

  // What the invoice shows, in both languages and both calendars. The screen
  // and the PDF are drawn from this and decide nothing themselves.
  @Get(':invoiceId')
  async one(@Param('invoiceId') invoiceId: string) {
    if (!isUuid(invoiceId)) throw new BadRequestException('Invalid invoice id');

    const found = await this.tenantDb.db.execute<InvoiceRow>(sql`
      select i.id,
             i.number,
             i.amount::text as amount,
             i.currency,
             i.description,
             i.issue_date::text as issue_date,
             i.due_date::text as due_date,
             s.full_name as student_name,
             t.name as school_name,
             t.name_i18n as school_name_i18n
        from invoices i
        join students s on s.tenant_id = i.tenant_id and s.id = i.student_id
        join tenants t on t.id = i.tenant_id
       where i.id = ${invoiceId}`);
    const row = found.rows[0];
    // Another school's invoice is not visible here, so it is not found either.
    if (!row) throw new NotFoundException('Invoice not found');

    const dated = async (gregorian: string) => ({
      gregorian,
      hijri: await this.calendar.toHijri(gregorian),
    });
    return {
      id: row.id,
      number: Number(row.number),
      school: { name: row.school_name, nameI18n: row.school_name_i18n },
      student: { fullName: row.student_name },
      description: row.description,
      // At the decimals of its currency. A currency the ledger does not know
      // keeps the decimals it was stored with.
      amount: isCurrency(row.currency)
        ? fromMinor(toMinor(row.amount, row.currency), row.currency)
        : row.amount,
      currency: row.currency,
      issueDate: await dated(row.issue_date),
      dueDate: row.due_date === null ? null : await dated(row.due_date),
    };
  }
}
