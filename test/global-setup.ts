import { fileURLToPath } from 'node:url';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import type { TestProject } from 'vitest/node';
import { migrate } from '../db/migrate.js';
import { seed } from '../db/seed.js';

const bootstrapSql = fileURLToPath(
  new URL('../db/bootstrap/roles.sql', import.meta.url),
);

export default async function setup(project: TestProject) {
  const container = await new PostgreSqlContainer('postgres:16-alpine')
    .withCopyFilesToContainer([
      { source: bootstrapSql, target: '/docker-entrypoint-initdb.d/roles.sql' },
    ])
    .start();

  const urlFor = (user: string, password: string) =>
    `postgres://${user}:${password}@${container.getHost()}:${container.getPort()}/${container.getDatabase()}`;
  const ownerUrl = urlFor('app_owner', 'dev_only_owner');

  await migrate(ownerUrl);
  await seed(ownerUrl);

  // The app under test only ever receives the runtime role's connection string.
  project.provide('databaseUrl', urlFor('app_runtime', 'dev_only_runtime'));
  project.provide('ownerDatabaseUrl', ownerUrl);
  // Only the worker under test and the role tests receive these two.
  project.provide(
    'dispatcherDatabaseUrl',
    urlFor('app_dispatcher', 'dev_only_dispatcher'),
  );
  project.provide('queueDatabaseUrl', urlFor('app_queue', 'dev_only_queue'));

  return async () => {
    await container.stop();
  };
}

declare module 'vitest' {
  export interface ProvidedContext {
    databaseUrl: string;
    ownerDatabaseUrl: string;
    dispatcherDatabaseUrl: string;
    queueDatabaseUrl: string;
  }
}
