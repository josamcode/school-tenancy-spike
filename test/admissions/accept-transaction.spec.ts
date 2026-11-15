import { ConflictException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { sql } from 'drizzle-orm';
import pg from 'pg';
import { applications, eventSchools, userEvents } from '../../db/seed.js';
import { AdmissionsService } from '../../src/admissions/admissions.service.js';
import { AppModule } from '../../src/app.module.js';
import { TenantDb } from '../../src/db/tenant-db.js';
import { inScope, runtimePool, until } from '../support/db.js';

const school = eventSchools.acceptRollback;

// One school with admissions on, written only by this file.
describe('an acceptance and its event share one transaction', () => {
  let moduleRef: TestingModule;
  let tenantDb: TenantDb;
  let admissions: AdmissionsService;
  let pool: pg.Pool;

  const state = (application: { id: string; applicantName: string }) =>
    inScope(pool, { tenantId: school.id }, async (client) => {
      const count = async (text: string, value: string) =>
        (await client.query<{ n: number }>(text, [value])).rows[0].n;
      return {
        status: (
          await client.query<{ status: string }>(
            'select status from admission_applications where id = $1',
            [application.id],
          )
        ).rows[0].status,
        students: await count(
          'select count(*)::int as n from students where full_name = $1',
          application.applicantName,
        ),
        events: await count(
          `select count(*)::int as n from outbox_events
            where payload->>'applicationId' = $1`,
          application.id,
        ),
      };
    });

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    await moduleRef.init();
    tenantDb = moduleRef.get(TenantDb, { strict: false });
    admissions = moduleRef.get(AdmissionsService, { strict: false });
    pool = runtimePool();
  });

  afterAll(async () => {
    await moduleRef.close();
    await pool.end();
  });

  it('leaves no student, no acceptance and no event when the transaction fails after the event was written', async () => {
    let emitted = 0;
    const attempt = tenantDb.run(userEvents.id, school.id, async () => {
      await admissions.accept(applications.rolledBack.id);
      // The event is visible inside the transaction that wrote it.
      const { rows } = await tenantDb.db.execute(
        sql`select id from outbox_events`,
      );
      emitted = rows.length;
      throw new Error('failed after the event was written');
    });
    await expect(attempt).rejects.toThrow('failed after the event was written');

    expect(emitted).toBe(1);
    expect(await state(applications.rolledBack)).toEqual({
      status: 'pending',
      students: 0,
      events: 0,
    });
  });

  it('keeps all three when the transaction commits, so the check above is not empty', async () => {
    await tenantDb.run(userEvents.id, school.id, () =>
      admissions.accept(applications.kept.id),
    );
    expect(await state(applications.kept)).toEqual({
      status: 'accepted',
      students: 1,
      events: 1,
    });
  });

  // The second accept starts while the first has accepted and not committed,
  // so the two are known to overlap. An accept that read the status without a
  // lock would see "pending" here and accept again once the first commits.
  it('refuses a second accept that overlaps the first: one student, one event, one conflict', async () => {
    const application = applications.overlapped;
    let commitFirst = () => {};
    const held = new Promise<void>((resolve) => {
      commitFirst = resolve;
    });
    let accepted = (_pid: number) => {};
    const firstAccepted = new Promise<number>((resolve) => {
      accepted = resolve;
    });

    const first = tenantDb.run(userEvents.id, school.id, async () => {
      const acceptance = await admissions.accept(application.id);
      const { rows } = await tenantDb.db.execute<{ pid: number }>(
        sql`select pg_backend_pid() as pid`,
      );
      accepted(rows[0].pid);
      await held;
      return acceptance;
    });
    const firstPid = await firstAccepted;

    let secondSettled = false;
    const second = tenantDb
      .run(userEvents.id, school.id, () => admissions.accept(application.id))
      .then(
        () => 'accepted',
        (error: unknown) => error,
      )
      .finally(() => {
        secondSettled = true;
      });
    // No fixed wait: the second accept is known to have reached the
    // application's row once a backend waits for a lock that the first
    // transaction holds. With the row lock that is its read. Without it, it is
    // its update of the same row.
    await until(async () => {
      const blocked = await pool.query(
        'select 1 from pg_stat_activity where $1::int = any (pg_blocking_pids(pid))',
        [firstPid],
      );
      return blocked.rows.length > 0;
    });
    expect(secondSettled).toBe(false);

    commitFirst();
    const acceptance = await first;
    const outcome = await second;

    expect(outcome).toBeInstanceOf(ConflictException);
    expect(await state(application)).toEqual({
      status: 'accepted',
      students: 1,
      events: 1,
    });
    const studentIds = await inScope(
      pool,
      { tenantId: school.id },
      async (client) =>
        (
          await client.query<{ student_id: string }>(
            'select student_id from admission_applications where id = $1',
            [application.id],
          )
        ).rows.map((row) => row.student_id),
    );
    expect(studentIds).toEqual([acceptance.studentId]);
  });

  it('cannot emit outside a tenant transaction', async () => {
    await expect(admissions.accept(applications.kept.id)).rejects.toThrow(
      'Database access outside a tenant transaction',
    );
  });
});
