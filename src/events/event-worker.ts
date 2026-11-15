import {
  Inject,
  Injectable,
  Logger,
  OnApplicationShutdown,
} from '@nestjs/common';
import type { JobWithMetadata } from 'pg-boss';
import { Dispatcher } from './dispatcher.js';
import { EventQueue } from './event-queue.js';
import { EventRunner } from './event-runner.js';
import { EventRef } from './event-types.js';
import { WebhookSender } from './webhook-sender.js';
import { WORKER_CONFIG } from './worker.config.js';
import type { WorkerConfig } from './worker.config.js';

// The dead-letter copy carries the output of the job's last run. For a handler
// that threw, that is the serialised error.
function lastError(job: { sourceOutput: object | null }): string {
  const message = (job.sourceOutput as { message?: unknown } | null)?.message;
  return typeof message === 'string' && message !== ''
    ? message
    : 'The job failed without reporting an error';
}

// Starts and stops the polling: the dispatcher's loop and one worker per
// queue. A failing or slow delivery waits in its own queue and takes nothing
// from the events queue.
@Injectable()
export class EventWorker implements OnApplicationShutdown {
  private readonly logger = new Logger(EventWorker.name);
  private timer?: NodeJS.Timeout;
  private dispatching = false;
  private working = false;

  constructor(
    @Inject(WORKER_CONFIG) private readonly config: WorkerConfig,
    private readonly queue: EventQueue,
    private readonly dispatcher: Dispatcher,
    private readonly runner: EventRunner,
    private readonly sender: WebhookSender,
  ) {}

  async start(): Promise<void> {
    await this.work();
    this.timer ??= setInterval(
      () => void this.dispatch(),
      this.config.dispatchIntervalMs,
    );
  }

  // The queue workers alone, without the dispatcher's loop.
  async work(): Promise<void> {
    if (this.working) return;
    this.working = true;
    const { boss, names } = this.queue;
    const options = {
      pollingIntervalSeconds: this.config.pollingIntervalSeconds,
    };
    await boss.work<EventRef>(
      names.events,
      { ...options, localConcurrency: 2 },
      ([job]) => this.runner.handle(job.data),
    );
    await boss.work<EventRef>(
      names.deliveries,
      { ...options, localConcurrency: 4 },
      ([job]) => this.sender.deliver(job.data),
    );
    await boss.work<EventRef>(names.dead, options, ([job]) =>
      this.sender.markFailed(job.data),
    );
    await boss.work(
      names.failedEvents,
      { ...options, includeMetadata: true },
      ([job]: JobWithMetadata<EventRef>[]) =>
        this.runner.recordFailure(job.data, lastError(job)),
    );
  }

  async stop(): Promise<void> {
    clearInterval(this.timer);
    this.timer = undefined;
    if (!this.working) return;
    this.working = false;
    const { boss, names } = this.queue;
    for (const name of Object.values(names)) {
      await boss.offWork(name, { wait: true });
    }
  }

  async onApplicationShutdown() {
    await this.stop();
  }

  private async dispatch(): Promise<void> {
    if (this.dispatching) return;
    this.dispatching = true;
    try {
      await this.dispatcher.dispatchOnce();
    } catch (error) {
      this.logger.error(error);
    } finally {
      this.dispatching = false;
    }
  }
}
