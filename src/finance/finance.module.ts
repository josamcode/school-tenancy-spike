import { Module } from '@nestjs/common';
import { CalendarModule } from '../calendar/calendar.module.js';
import { DbModule } from '../db/db.module.js';
import { InvoicesController } from './invoices.controller.js';
import { LedgerService } from './ledger.service.js';
import { RegistrationFeeHandler } from './registration-fee.handler.js';

@Module({
  imports: [DbModule, CalendarModule],
  controllers: [InvoicesController],
  providers: [LedgerService, RegistrationFeeHandler],
})
export class FinanceModule {}
