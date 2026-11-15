import { fileURLToPath } from 'node:url';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { migrate } from '../../db/migrate.js';
import { seed } from '../../db/seed.js';

const bootstrapSql = fileURLToPath(
  new URL('../../db/bootstrap/roles.sql', import.meta.url),
);

export interface TestDatabase {
  runtimeUrl: string;
  ownerUrl: string;
  dispatcherUrl: string;
  queueUrl: string;
  stop: () => Promise<void>;
}

// A PostgreSQL 16 container with the roles, the migrations and the seed.
export async function startDatabase(): Promise<TestDatabase> {
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

  return {
    runtimeUrl: urlFor('app_runtime', 'dev_only_runtime'),
    ownerUrl,
    dispatcherUrl: urlFor('app_dispatcher', 'dev_only_dispatcher'),
    queueUrl: urlFor('app_queue', 'dev_only_queue'),
    stop: async () => {
      await container.stop();
    },
  };
}
