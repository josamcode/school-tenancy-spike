import { ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { sql } from 'drizzle-orm';
import {
  schoolA,
  schoolB,
  studentsA,
  studentsB,
  userA,
} from '../../db/seed.js';
import { DbModule } from '../../src/db/db.module.js';
import { TenantDb } from '../../src/db/tenant-db.js';

describe('TenantDb', () => {
  let moduleRef: TestingModule;
  let tenantDb: TenantDb;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [DbModule],
    }).compile();
    tenantDb = moduleRef.get(TenantDb);
  });

  afterAll(async () => {
    await moduleRef.close();
  });

  it('throws when used outside a tenant transaction', () => {
    expect(() => tenantDb.db).toThrow(/outside a tenant transaction/);
  });

  it('runs the callback with the confirmed school as the tenant', async () => {
    const rows = await tenantDb.run(userA.id, schoolA.id, async () => {
      const result = await tenantDb.db.execute<{ id: string }>(
        sql`select id from students`,
      );
      return result.rows;
    });
    const ids = rows.map((r) => r.id);
    expect(ids).toEqual(expect.arrayContaining(studentsA.map((s) => s.id)));
    for (const student of studentsB) expect(ids).not.toContain(student.id);
  });

  it('refuses a school the user is not a member of and never runs the callback', async () => {
    const callback = vi.fn(async () => 'ran');
    await expect(
      tenantDb.run(userA.id, schoolB.id, callback),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(callback).not.toHaveBeenCalled();
  });

  it('rejects a handle that is used after its transaction has ended', async () => {
    const leaked = await tenantDb.run(
      userA.id,
      schoolA.id,
      async () => tenantDb.db,
    );
    await expect(leaked.execute(sql`select 1`)).rejects.toMatchObject({
      cause: { message: expect.stringContaining('transaction has ended') },
    });
  });

  it('rejects a late call that still carries the request context', async () => {
    let late: Promise<unknown> = Promise.resolve();
    await tenantDb.run(userA.id, schoolA.id, async () => {
      late = new Promise((resolve) => setTimeout(resolve, 50)).then(() =>
        tenantDb.db.execute(sql`select id from students`),
      );
      late.catch(() => {});
    });
    await expect(late).rejects.toThrow(/transaction has ended/);
  });

  it('rolls back when the callback throws', async () => {
    const name = 'Rolled Back';
    await expect(
      tenantDb.run(userA.id, schoolA.id, async () => {
        await tenantDb.db.execute(
          sql`insert into students (full_name) values (${name})`,
        );
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    const rows = await tenantDb.run(userA.id, schoolA.id, async () => {
      const result = await tenantDb.db.execute(
        sql`select 1 from students where full_name = ${name}`,
      );
      return result.rows;
    });
    expect(rows).toEqual([]);
  });
});
