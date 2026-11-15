import pg from 'pg';
import { expect, inject } from 'vitest';

export function runtimePool(max = 4): pg.Pool {
  return new pg.Pool({ connectionString: inject('databaseUrl'), max });
}

// Only for provisioning checks that the runtime role cannot perform at all.
export function ownerPool(): pg.Pool {
  return new pg.Pool({ connectionString: inject('ownerDatabaseUrl'), max: 1 });
}

export interface Scope {
  userId?: string;
  tenantId?: string;
}

// Runs fn in a transaction with the given settings and always rolls back.
export async function inScope<T>(
  pool: pg.Pool,
  scope: Scope,
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    if (scope.userId) {
      await client.query("select set_config('app.user_id', $1, true)", [
        scope.userId,
      ]);
    }
    if (scope.tenantId) {
      await client.query("select set_config('app.tenant_id', $1, true)", [
        scope.tenantId,
      ]);
    }
    return await fn(client);
  } finally {
    await client.query('rollback');
    client.release();
  }
}

export interface Failure {
  code: string;
  message: string;
  detail: string;
}

export async function failureOf(
  run: () => Promise<unknown>,
): Promise<Failure | null> {
  try {
    await run();
  } catch (error) {
    const { code, message, detail } = error as Partial<Failure>;
    return {
      code: code ?? '',
      message: message ?? String(error),
      detail: detail ?? '',
    };
  }
  return null;
}

// Both are SQLSTATE 42501, so the message tells them apart.
export const rlsViolation = {
  code: '42501',
  message: expect.stringContaining('row-level security'),
};
export const permissionDenied = {
  code: '42501',
  message: expect.stringContaining('permission denied'),
};
export const foreignKeyViolation = { code: '23503' };
export const uniqueViolation = { code: '23505' };

// Commits, unlike inScope. Use it only on a school that no other test reads.
export async function asOwnerOf(
  tenantId: string,
  fn: (client: pg.PoolClient) => Promise<void>,
): Promise<void> {
  const pool = ownerPool();
  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query("select set_config('app.tenant_id', $1, true)", [
      tenantId,
    ]);
    await fn(client);
    await client.query('commit');
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

// Commits as the owner with no tenant set, for provisioning tables.
export async function asOwner(
  fn: (client: pg.PoolClient) => Promise<void>,
): Promise<void> {
  const pool = ownerPool();
  const client = await pool.connect();
  try {
    await client.query('begin');
    await fn(client);
    await client.query('commit');
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}
