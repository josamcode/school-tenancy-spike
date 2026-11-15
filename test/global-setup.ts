import { fileURLToPath } from 'node:url';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import type { TestProject } from 'vitest/node';
import { migrate } from '../db/migrate.js';

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

  // The app under test only ever receives the runtime role's connection string.
  project.provide('databaseUrl', urlFor('app_runtime', 'dev_only_runtime'));
  project.provide('ownerDatabaseUrl', ownerUrl);

  return async () => {
    await container.stop();
  };
}

declare module 'vitest' {
  export interface ProvidedContext {
    databaseUrl: string;
    ownerDatabaseUrl: string;
  }
}
