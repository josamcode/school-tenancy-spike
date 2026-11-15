import type { TestProject } from 'vitest/node';
import { startDatabase } from './support/database.js';

export default async function setup(project: TestProject) {
  const database = await startDatabase();

  // The app under test only ever receives the runtime role's connection string.
  project.provide('databaseUrl', database.runtimeUrl);
  project.provide('ownerDatabaseUrl', database.ownerUrl);
  // Only the worker under test and the role tests receive these two.
  project.provide('dispatcherDatabaseUrl', database.dispatcherUrl);
  project.provide('queueDatabaseUrl', database.queueUrl);

  return database.stop;
}

declare module 'vitest' {
  export interface ProvidedContext {
    databaseUrl: string;
    ownerDatabaseUrl: string;
    dispatcherDatabaseUrl: string;
    queueDatabaseUrl: string;
  }
}
