import { Module } from '@nestjs/common';
import { DbModule } from '../db/db.module.js';
import { InvoicesController } from './invoices.controller.js';
import { LedgerService } from './ledger.service.js';

@Module({
  imports: [DbModule],
  controllers: [InvoicesController],
  providers: [LedgerService],
})
export class FinanceModule {}
