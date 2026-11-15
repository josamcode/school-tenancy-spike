import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { PgBoss } from 'pg-boss';
import { EventRef } from './event-types.js';
import { WORKER_CONFIG } from './worker.config.js';
import type { WorkerConfig } from './worker.config.js';

// pg-boss, connected as the queue role, which can reach nothing outside its
// own schema. A job carries an event id and a school id and nothing else.
@Injectable()
export class EventQueue
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  readonly boss: PgBoss;
  readonly names: { events: string; deliveries: string; dead: string };
  private readonly logger = new Logger(EventQueue.name);

  constructor(@Inject(WORKER_CONFIG) private readonly config: WorkerConfig) {
    const prefix = config.queuePrefix;
    this.names = {
      events: `${prefix}events`,
      deliveries: `${prefix}webhook-deliveries`,
      dead: `${prefix}webhook-deliveries-dead`,
    };
    this.boss = new PgBoss({
      connectionString: config.queueUrl,
      schema: 'pgboss',
      // The schema is created by a migration. The queue role may not create one.
      createSchema: false,
      schedule: false,
    });
    this.boss.on('error', (error) => this.logger.error(error));
  }

  async onApplicationBootstrap() {
    await this.boss.start();
    const { webhook } = this.config;
    await this.boss.createQueue(this.names.dead);
    await this.boss.createQueue(this.names.deliveries, {
      retryLimit: webhook.retryLimit,
      retryDelay: webhook.retryDelaySeconds,
      retryBackoff: true,
      retryDelayMax: 3600,
      // A job whose worker died is failed after this long and retried.
      expireInSeconds: 60,
      // After the last retry the job is copied here, and its worker marks
      // the delivery failed.
      deadLetter: this.names.dead,
    });
    await this.boss.createQueue(this.names.events, {
      retryLimit: 5,
      retryDelay: 1,
      retryBackoff: true,
      retryDelayMax: 60,
      expireInSeconds: 60,
    });
  }

  async onApplicationShutdown() {
    await this.boss.stop({ graceful: true, timeout: 10_000 });
  }

  // Both are keyed by the event id, so sending one again while its job is
  // kept adds nothing.
  async sendEvent(ref: EventRef): Promise<void> {
    await this.boss.send(this.names.events, { ...ref }, { id: ref.eventId });
  }

  async sendDelivery(ref: EventRef): Promise<void> {
    await this.boss.send(
      this.names.deliveries,
      { ...ref },
      { id: ref.eventId },
    );
  }
}
