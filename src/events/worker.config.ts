export const WORKER_CONFIG = Symbol('WORKER_CONFIG');

export interface WorkerConfig {
  dispatcherUrl: string;
  queueUrl: string;
  // Put before every queue name, so two workers can share a database.
  queuePrefix: string;
  pollingIntervalSeconds: number;
  dispatchIntervalMs: number;
  events: {
    // Retries of an events job after its first run, with exponential backoff.
    // After the last one the event is recorded in event_failures.
    retryLimit: number;
    retryDelaySeconds: number;
  };
  webhook: {
    // Retries after the first attempt, with exponential backoff.
    retryLimit: number;
    retryDelaySeconds: number;
    // How long one request may take before it counts as failed.
    timeoutMs: number;
  };
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

export function workerConfigFromEnv(): WorkerConfig {
  return {
    dispatcherUrl: required('DISPATCHER_DATABASE_URL'),
    queueUrl: required('QUEUE_DATABASE_URL'),
    queuePrefix: '',
    pollingIntervalSeconds: 2,
    dispatchIntervalMs: 1000,
    events: { retryLimit: 5, retryDelaySeconds: 1 },
    webhook: { retryLimit: 5, retryDelaySeconds: 30, timeoutMs: 5000 },
  };
}
