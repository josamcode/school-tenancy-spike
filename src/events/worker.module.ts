import { DynamicModule, Module } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { DbModule } from '../db/db.module.js';
import { FinanceModule } from '../finance/finance.module.js';
import { Dispatcher } from './dispatcher.js';
import { EventHandlers } from './event-handlers.js';
import { EventQueue } from './event-queue.js';
import { EventRunner } from './event-runner.js';
import { EventWorker } from './event-worker.js';
import { WebhookSender } from './webhook-sender.js';
import { WORKER_CONFIG, WorkerConfig } from './worker.config.js';

// Everything that delivers events. The HTTP application does not import this
// module, so it never holds the dispatcher's or the queue's credentials.
@Module({})
export class WorkerModule {
  static register(config: WorkerConfig): DynamicModule {
    return {
      module: WorkerModule,
      imports: [DiscoveryModule, DbModule, FinanceModule],
      providers: [
        { provide: WORKER_CONFIG, useValue: config },
        EventHandlers,
        EventQueue,
        Dispatcher,
        EventRunner,
        WebhookSender,
        EventWorker,
      ],
    };
  }
}
