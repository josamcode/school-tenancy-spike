import { Module } from '@nestjs/common';
import { DbModule } from '../db/db.module.js';
import { InvoicesController } from './invoices.controller.js';

@Module({
  imports: [DbModule],
  controllers: [InvoicesController],
})
export class FinanceModule {}
