import { Module } from '@nestjs/common';
import { DbModule } from '../db/db.module.js';
import { Outbox } from './outbox.js';

// What a module needs to emit events. Delivery lives in the worker.
@Module({
  imports: [DbModule],
  providers: [Outbox],
  exports: [Outbox],
})
export class EventsModule {}
