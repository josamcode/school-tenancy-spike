import { sql } from 'drizzle-orm';
import pg from 'pg';
import {
  schoolA,
  schoolB,
  studentsA,
  studentsB,
  userA,
  userB,
} from '../../db/seed.js';
import { TenantDb } from '../../src/db/tenant-db.js';
import { runtimePool } from '../support/db.js';

describe('TenantDb when the rollback fails', () => {
  let pool: pg.Pool;
  let tenantDb: TenantDb;

  beforeAll(() => {
    pool = runtimePool(1);
    tenantDb = new TenantDb(pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  const backendPid = async () => {
    const result = await tenantDb.db.execute<{ pid: number }>(
      sql`select pg_backend_pid() as pid`,
    );
    return result.rows[0].pid;
  };

  it('rejects with the original error, drops the connection and serves the next school on a new one', async () => {
    let killedPid = 0;
    const failed = tenantDb.run(userA.id, schoolA.id, async () => {
      killedPid = await backendPid();
      // The connection dies inside the transaction, so the rollback cannot succeed.
      await tenantDb.db.execute(
        sql`select pg_terminate_backend(pg_backend_pid())`,
      );
    });

    // Drizzle wraps the driver error, so the SQLSTATE is on the cause.
    await expect(failed).rejects.toMatchObject({ cause: { code: '57P01' } });
    expect(killedPid).toBeGreaterThan(0);
    expect(pool.totalCount).toBe(0);
    expect(pool.idleCount).toBe(0);

    const next = await tenantDb.run(userB.id, schoolB.id, async () => {
      const students = await tenantDb.db.execute<{
        id: string;
        tenant_id: string;
      }>(sql`select id, tenant_id from students`);
      return { pid: await backendPid(), students: students.rows };
    });

    expect(next.pid).not.toBe(killedPid);
    const ids = next.students.map((s) => s.id);
    expect(ids).toEqual(expect.arrayContaining(studentsB.map((s) => s.id)));
    expect(next.students.every((s) => s.tenant_id === schoolB.id)).toBe(true);
    for (const student of studentsA) expect(ids).not.toContain(student.id);
  });
});
