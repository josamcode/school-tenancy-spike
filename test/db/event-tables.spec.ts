import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { eventSchools, schoolA, schoolB, userEvents } from '../../db/seed.js';
import {
  asOwnerOf,
  checkViolation,
  failureOf,
  inScope,
  notNullViolation,
  ownerPool,
  permissionDenied,
  refused,
  rlsViolation,
  runtimePool,
  sleep,
  uniqueViolation,
} from '../support/db.js';

const school = eventSchools.tables;
const other = eventSchools.tablesOther;
const scope = { userId: userEvents.id, tenantId: school.id };

// The lock a handler takes before it reads whether a module is on.
const sharedModuleLock = `select pg_advisory_xact_lock_shared(
  hashtextextended($1 || ':module:' || $2, 0))`;

// Two schools, written only by this file. Every test but the endpoint setup
// rolls back.
describe('the event tables', () => {
  let runtime: pg.Pool;
  let owner: pg.Pool;

  beforeAll(() => {
    runtime = runtimePool();
    owner = ownerPool();
  });

  afterAll(async () => {
    await runtime.end();
    await owner.end();
  });

  const newEvent = async (client: pg.PoolClient): Promise<string> => {
    const { rows } = await client.query<{ id: string }>(
      `insert into outbox_events (type, payload)
       values ('student.accepted', '{}') returning id`,
    );
    return rows[0].id;
  };

  describe('outbox_events', () => {
    it('takes the school and the actor from the transaction', async () => {
      const row = await inScope(runtime, scope, async (client) => {
        const id = await newEvent(client);
        const { rows } = await client.query(
          `select tenant_id, actor_user_id, dispatched_at
             from outbox_events where id = $1`,
          [id],
        );
        return rows[0];
      });
      expect(row).toEqual({
        tenant_id: school.id,
        actor_user_id: userEvents.id,
        dispatched_at: null,
      });
    });

    it('refuses an event with no actor', async () => {
      const failure = await failureOf(() =>
        inScope(runtime, { tenantId: school.id }, newEvent),
      );
      expect(failure).toMatchObject(notNullViolation);
    });

    it('refuses an event with no school', async () => {
      const failure = await failureOf(() =>
        inScope(runtime, { userId: userEvents.id }, newEvent),
      );
      expect(failure).toMatchObject(rlsViolation);
    });

    it('refuses an unknown event type', async () => {
      const failure = await failureOf(() =>
        inScope(runtime, scope, (client) =>
          client.query(
            `insert into outbox_events (type, payload) values ('student.expelled', '{}')`,
          ),
        ),
      );
      expect(failure).toMatchObject(checkViolation);
    });
  });

  describe('processed_events', () => {
    it('holds one handler per event', async () => {
      const failure = await failureOf(() =>
        inScope(runtime, scope, async (client) => {
          const id = await newEvent(client);
          await client.query(
            `insert into processed_events (event_id, handler) values ($1, 'finance')`,
            [id],
          );
          await client.query(
            `insert into processed_events (event_id, handler) values ($1, 'webhook')`,
            [id],
          );
        }),
      );
      expect(failure).toMatchObject(uniqueViolation);
    });

    it('refuses a handler that is not finance or webhook', async () => {
      const failure = await failureOf(() =>
        inScope(runtime, scope, async (client) => {
          const id = await newEvent(client);
          await client.query(
            `insert into processed_events (event_id, handler) values ($1, 'transport')`,
            [id],
          );
        }),
      );
      expect(failure).toMatchObject(checkViolation);
    });

    it('refuses a row for an event that does not exist in this school', async () => {
      const failure = await failureOf(() =>
        inScope(runtime, scope, (client) =>
          client.query(
            `insert into processed_events (event_id, handler) values ($1, 'finance')`,
            [randomUUID()],
          ),
        ),
      );
      expect(failure).toMatchObject({ code: '23503' });
    });

    it('refuses a row written for another school', async () => {
      const failure = await failureOf(() =>
        inScope(runtime, scope, async (client) => {
          const id = await newEvent(client);
          await client.query(
            `insert into processed_events (tenant_id, event_id, handler)
             values ($1, $2, 'finance')`,
            [other.id, id],
          );
        }),
      );
      expect(failure).toMatchObject(rlsViolation);
    });

    it.each([
      ['update', `update processed_events set handler = 'webhook'`],
      ['delete', 'delete from processed_events'],
    ])('cannot be changed by the runtime role: %s', async (_what, query) => {
      const failure = await failureOf(() =>
        inScope(runtime, scope, (client) => client.query(query)),
      );
      expect(failure).toMatchObject(permissionDenied);
    });
  });

  describe('webhook_deliveries', () => {
    const pendingDelivery = async (client: pg.PoolClient) => {
      const id = await newEvent(client);
      await client.query(
        `insert into processed_events (event_id, handler) values ($1, 'webhook')`,
        [id],
      );
      await client.query(
        'insert into webhook_deliveries (event_id) values ($1)',
        [id],
      );
      return id;
    };

    it('starts pending', async () => {
      const status = await inScope(runtime, scope, async (client) => {
        const id = await pendingDelivery(client);
        const { rows } = await client.query(
          'select status, finished_at from webhook_deliveries where event_id = $1',
          [id],
        );
        return rows[0];
      });
      expect(status).toEqual({ status: 'pending', finished_at: null });
    });

    it.each(['delivered', 'failed'])(
      'cannot leave the final state %s',
      async (final) => {
        const counts = await inScope(runtime, scope, async (client) => {
          const id = await pendingDelivery(client);
          const finish = await client.query(
            `update webhook_deliveries set status = $2, finished_at = now()
              where event_id = $1`,
            [id, final],
          );
          const reopen = await client.query(
            `update webhook_deliveries set status = 'pending', finished_at = null
              where event_id = $1`,
            [id],
          );
          const flip = await client.query(
            `update webhook_deliveries set status = 'failed' where event_id = $1`,
            [id],
          );
          return [finish.rowCount, reopen.rowCount, flip.rowCount];
        });
        expect(counts).toEqual([1, 0, 0]);
      },
    );

    it('needs a recorded webhook decision', async () => {
      const failure = await failureOf(() =>
        inScope(runtime, scope, async (client) => {
          const id = await newEvent(client);
          await client.query(
            'insert into webhook_deliveries (event_id) values ($1)',
            [id],
          );
        }),
      );
      expect(failure).toMatchObject({ code: '23503' });
    });

    it('cannot be deleted by the runtime role', async () => {
      const failure = await failureOf(() =>
        inScope(runtime, scope, (client) =>
          client.query('delete from webhook_deliveries'),
        ),
      );
      expect(failure).toMatchObject(permissionDenied);
    });
  });

  describe('webhook_endpoints', () => {
    beforeAll(async () => {
      for (const [id, name] of [
        [school.id, 'tables'],
        [other.id, 'other'],
      ]) {
        await asOwnerOf(id, async (client) => {
          await client.query(
            `insert into webhook_endpoints (url, secret) values ($1, $2)
             on conflict (tenant_id) do nothing`,
            [`http://127.0.0.1:9/${name}`, `whsec_${name}`],
          );
        });
      }
    });

    it('shows a school its own endpoint and no other', async () => {
      const rows = await inScope(
        runtime,
        scope,
        async (client) =>
          (await client.query('select tenant_id, url from webhook_endpoints'))
            .rows,
      );
      expect(rows).toEqual([
        { tenant_id: school.id, url: 'http://127.0.0.1:9/tables' },
      ]);
    });

    it('shows nothing without a school', async () => {
      const { rows } = await runtime.query('select url from webhook_endpoints');
      expect(rows).toEqual([]);
    });

    it.each([
      [
        'insert',
        `insert into webhook_endpoints (url, secret) values ('http://x', 's')`,
      ],
      ['update', `update webhook_endpoints set url = 'http://x'`],
      ['delete', 'delete from webhook_endpoints'],
    ])('is provisioned by the owner only: %s', async (_what, query) => {
      const failure = await failureOf(() =>
        inScope(runtime, scope, (client) => client.query(query)),
      );
      expect(failure).toMatchObject(permissionDenied);
    });
  });

  describe('registration_fees', () => {
    it('is provisioned by the owner only', async () => {
      const failure = await failureOf(() =>
        inScope(runtime, scope, (client) =>
          client.query(
            `insert into registration_fees
               (amount, currency, receivable_account_id, income_account_id)
             values ('500.00', 'AED', $1, $1)`,
            [randomUUID()],
          ),
        ),
      );
      expect(failure).toMatchObject(permissionDenied);
    });

    it('needs accounts that exist in the school, in the fee’s currency', async () => {
      const client = await owner.connect();
      try {
        await client.query('begin');
        await client.query("select set_config('app.tenant_id', $1, true)", [
          school.id,
        ]);
        const failure = await failureOf(() =>
          client.query(
            `insert into registration_fees
               (amount, currency, receivable_account_id, income_account_id)
             values ('500.00', 'AED', $1, $1)`,
            [randomUUID()],
          ),
        );
        expect(failure).toMatchObject({ code: '23503' });
      } finally {
        await client.query('rollback');
        client.release();
      }
    });
  });

  describe('admission_applications', () => {
    const asOwnerRolledBack = async (
      fn: (client: pg.PoolClient) => Promise<unknown>,
    ) => {
      const client = await owner.connect();
      try {
        await client.query('begin');
        await client.query("select set_config('app.tenant_id', $1, true)", [
          school.id,
        ]);
        return await fn(client);
      } finally {
        await client.query('rollback');
        client.release();
      }
    };

    it('cannot be accepted without a student', async () => {
      const failure = await failureOf(() =>
        asOwnerRolledBack((client) =>
          client.query(
            `insert into admission_applications (applicant_name, status)
             values ('Nobody', 'accepted')`,
          ),
        ),
      );
      expect(failure).toMatchObject(checkViolation);
    });

    it('cannot be pending with a student', async () => {
      const failure = await failureOf(() =>
        asOwnerRolledBack((client) =>
          client.query(
            `insert into admission_applications (applicant_name, student_id)
             values ('Nobody', $1)`,
            [school.student],
          ),
        ),
      );
      expect(failure).toMatchObject(checkViolation);
    });

    it('cannot name a student of another school', async () => {
      const failure = await failureOf(() =>
        asOwnerRolledBack((client) =>
          client.query(
            `insert into admission_applications
               (applicant_name, status, student_id, accepted_at, accepted_by)
             values ('Nobody', 'accepted', $1, now(), $2)`,
            [other.student, userEvents.id],
          ),
        ),
      );
      expect(failure).toMatchObject({ code: '23503' });
    });

    it.each([
      [
        'create an application',
        `insert into admission_applications (applicant_name) values ('Nobody')`,
      ],
      [
        'rename an applicant',
        `update admission_applications set applicant_name = 'Somebody'`,
      ],
      ['delete an application', 'delete from admission_applications'],
    ])('does not let the runtime role %s', async (_what, query) => {
      const failure = await failureOf(() =>
        inScope(runtime, scope, (client) => client.query(query)),
      );
      expect(failure).toMatchObject(permissionDenied);
    });
  });

  describe('switching a module', () => {
    const switchFinance = async (client: pg.PoolClient, schoolId: string) => {
      await client.query('begin');
      await client.query("select set_config('app.tenant_id', $1, true)", [
        schoolId,
      ]);
      return client.query(
        `update tenant_modules set enabled = not enabled where module = 'finance'`,
      );
    };

    it('waits for a handler that holds the module’s lock, then goes through', async () => {
      const handler = await runtime.connect();
      const switcher = await owner.connect();
      try {
        await handler.query('begin');
        await handler.query(sharedModuleLock, [school.id, 'finance']);

        let finished = false;
        const pending = switchFinance(switcher, school.id).then((result) => {
          finished = true;
          return result;
        });
        await sleep(300);
        expect(finished).toBe(false);

        await handler.query('rollback');
        expect((await pending).rowCount).toBe(1);
      } finally {
        await handler.query('rollback');
        await switcher.query('rollback');
        handler.release();
        switcher.release();
      }
    });

    it('does not wait for a handler of another school', async () => {
      const handler = await runtime.connect();
      const switcher = await owner.connect();
      try {
        await handler.query('begin');
        await handler.query(sharedModuleLock, [schoolB.id, 'finance']);
        const started = Date.now();
        const result = await switchFinance(switcher, school.id);
        expect(Date.now() - started).toBeLessThan(250);
        expect(result.rowCount).toBe(1);
      } finally {
        await handler.query('rollback');
        await switcher.query('rollback');
        handler.release();
        switcher.release();
      }
    });
  });

  describe('a school’s timezone', () => {
    const insertTenant = async (columns: string, values: string) => {
      const client = await owner.connect();
      try {
        await client.query('begin');
        return await failureOf(() =>
          client.query(
            `insert into tenants (id, name${columns}) values ($1, 'Timezone School'${values})`,
            [randomUUID()],
          ),
        );
      } finally {
        await client.query('rollback');
        client.release();
      }
    };

    it('is required', async () => {
      expect(await insertTenant('', '')).toMatchObject(notNullViolation);
    });

    it.each(['Mars/Olympus', 'FOO3', 'asia/dubai', '+04:00', ''])(
      'refuses %j, which is not an IANA name',
      async (name) => {
        expect(await insertTenant(', timezone', `, '${name}'`)).toMatchObject(
          refused('is not an IANA time zone name'),
        );
      },
    );

    it.each(['Asia/Dubai', 'Europe/London', 'UTC'])(
      'accepts %s',
      async (name) => {
        expect(await insertTenant(', timezone', `, '${name}'`)).toBeNull();
      },
    );

    it('is Asia/Dubai for the seeded schools', async () => {
      for (const seeded of [schoolA, schoolB, school]) {
        const rows = await inScope(
          runtime,
          { tenantId: seeded.id },
          async (client) =>
            (await client.query('select timezone from tenants')).rows,
        );
        expect(rows).toEqual([{ timezone: 'Asia/Dubai' }]);
      }
    });
  });
});
