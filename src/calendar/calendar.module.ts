import { Module } from '@nestjs/common';
import { DbModule } from '../db/db.module.js';
import { HijriCalendar } from './hijri-calendar.js';

@Module({
  imports: [DbModule],
  providers: [HijriCalendar],
  exports: [HijriCalendar],
})
export class CalendarModule {}
