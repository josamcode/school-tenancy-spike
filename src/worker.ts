import { NestFactory } from '@nestjs/core';
import { EventWorker } from './events/event-worker.js';
import { workerConfigFromEnv } from './events/worker.config.js';
import { WorkerModule } from './events/worker.module.js';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(
    WorkerModule.register(workerConfigFromEnv()),
  );
  app.enableShutdownHooks();
  await app.get(EventWorker).start();
}
await bootstrap();
