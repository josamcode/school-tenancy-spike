import { Module } from '@nestjs/common';
import { DbModule } from '../db/db.module.js';
import { EventStatus } from './event-status.js';
import { Outbox } from './outbox.js';

// What a module needs to emit events and to read what became of them.
// Delivery lives in the worker.
@Module({
  imports: [DbModule],
  providers: [Outbox, EventStatus],
  exports: [Outbox, EventStatus],
})
export class EventsModule {}
