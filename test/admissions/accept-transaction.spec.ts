import { Test, TestingModule } from '@nestjs/testing';
import { sql } from 'drizzle-orm';
import pg from 'pg';
import { applications, eventSchools, userEvents } from '../../db/seed.js';
import { AdmissionsService } from '../../src/admissions/admissions.service.js';
import { AppModule } from '../../src/app.module.js';
import { TenantDb } from '../../src/db/tenant-db.js';
import { inScope, runtimePool } from '../support/db.js';

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

  it('cannot emit outside a tenant transaction', async () => {
    await expect(admissions.accept(applications.kept.id)).rejects.toThrow(
      'Database access outside a tenant transaction',
    );
  });
});
