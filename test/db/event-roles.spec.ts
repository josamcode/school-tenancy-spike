import pg from 'pg';
import { eventSchools, userEvents } from '../../db/seed.js';
import {
  committed,
  dispatcherPool,
  failureOf,
  inScope,
  permissionDenied,
  queuePool,
  rlsViolation,
  runtimePool,
} from '../support/db.js';

const one = eventSchools.rolesOne;
const two = eventSchools.rolesTwo;

const attributes = `select rolsuper, rolbypassrls, rolcreaterole, rolcreatedb, rolreplication
                      from pg_roles where rolname = current_user`;
const plain = {
  rolsuper: false,
  rolbypassrls: false,
  rolcreaterole: false,
  rolcreatedb: false,
  rolreplication: false,
};
const memberOf = `select r.rolname
                    from pg_auth_members m
                    join pg_roles r on r.oid = m.roleid
                   where m.member = (select oid from pg_roles where rolname = current_user)`;
const owned = `select c.relname
                 from pg_class c
                where c.relowner = (select oid from pg_roles where rolname = current_user)`;
// Every relation the connected role holds any privilege on, outside the catalogs.
const reachable = `select n.nspname as schema, c.relname as name
                     from pg_class c
                     join pg_namespace n on n.oid = c.relnamespace
                    where c.relkind in ('r', 'p', 'v', 'm', 'f')
                      and n.nspname !~ '^pg_'
                      and n.nspname <> 'information_schema'
                      and (has_table_privilege(current_user, c.oid,
                             'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
                           or has_any_column_privilege(current_user, c.oid,
                             'SELECT, INSERT, UPDATE, REFERENCES'))
                    order by 1, 2`;
const schemas = `select nspname as name,
                        has_schema_privilege(current_user, oid, 'USAGE') as usage,
                        has_schema_privilege(current_user, oid, 'CREATE') as "create"
                   from pg_namespace
                  where nspname !~ '^pg_'
                    and nspname <> 'information_schema'
                    and (has_schema_privilege(current_user, oid, 'USAGE')
                         or has_schema_privilege(current_user, oid, 'CREATE'))
                  order by 1`;

// Two schools, each with one committed event, written only by this file.
// No dispatcher runs while this file does, so the events stay undispatched.
describe('the dispatcher and queue roles', () => {
  let runtime: pg.Pool;
  let dispatcher: pg.Pool;
  let queue: pg.Pool;
  const events: Record<string, string[]> = { [one.id]: [], [two.id]: [] };

  beforeAll(() => {
    runtime = runtimePool();
    dispatcher = dispatcherPool();
    queue = queuePool();
  });

  // Called by the tests that need events, so the others fail or pass on
  // their own.
  let committing: Promise<void> | undefined;
  const withEvents = () =>
    (committing ??= (async () => {
      for (const school of [one, two]) {
        for (let i = 0; i < 2; i++) {
          const { rows } = await committed(
            runtime,
            { userId: userEvents.id, tenantId: school.id },
            (client) =>
              client.query<{ id: string }>(
                `insert into outbox_events (type, payload)
                 values ('student.accepted', '{"private": "payload"}') returning id`,
              ),
          );
          events[school.id].push(rows[0].id);
        }
      }
    })());

  afterAll(async () => {
    await runtime?.end();
    await dispatcher?.end();
    await queue?.end();
  });

  describe('app_dispatcher', () => {
    it('is a plain role: no superuser, no BYPASSRLS, member of nothing, owner of nothing', async () => {
      expect((await dispatcher.query(attributes)).rows[0]).toEqual(plain);
      expect((await dispatcher.query(memberOf)).rows).toEqual([]);
      expect((await dispatcher.query(owned)).rows).toEqual([]);
      const { rows } = await dispatcher.query(
        'select current_user::text as current',
      );
      expect(rows[0].current).toBe('app_dispatcher');
    });

    it('reaches the outbox and no other relation', async () => {
      const { rows } = await dispatcher.query(reachable);
      expect(rows).toEqual([{ schema: 'public', name: 'outbox_events' }]);
    });

    it('may use the public schema only, and create nowhere', async () => {
      const { rows } = await dispatcher.query(schemas);
      expect(rows).toEqual([{ name: 'public', usage: true, create: false }]);
    });

    it('may read four columns and write one', async () => {
      const { rows } = await dispatcher.query(
        `select a.attname as "column",
                has_column_privilege(current_user, a.attrelid, a.attnum, 'SELECT') as "select",
                has_column_privilege(current_user, a.attrelid, a.attnum, 'UPDATE') as "update",
                has_column_privilege(current_user, a.attrelid, a.attnum, 'INSERT') as "insert"
           from pg_attribute a
          where a.attrelid = 'public.outbox_events'::regclass
            and a.attnum > 0 and not a.attisdropped
          order by 1`,
      );
      const columns = (privilege: 'select' | 'update' | 'insert') =>
        rows.filter((row) => row[privilege]).map((row) => row.column);
      expect(columns('select')).toEqual([
        'created_at',
        'dispatched_at',
        'id',
        'tenant_id',
      ]);
      expect(columns('update')).toEqual(['dispatched_at']);
      expect(columns('insert')).toEqual([]);
    });

    it('sees which event belongs to which school, across schools', async () => {
      await withEvents();
      const { rows } = await dispatcher.query(
        'select id, tenant_id from outbox_events where id = any($1)',
        [[...events[one.id], ...events[two.id]]],
      );
      expect(rows).toHaveLength(4);
      for (const school of [one, two]) {
        expect(
          rows
            .filter((row) => row.tenant_id === school.id)
            .map((row) => row.id)
            .sort(),
        ).toEqual([...events[school.id]].sort());
      }
    });

    it.each([
      ['the payload', 'select payload from outbox_events'],
      ['the type', 'select type from outbox_events'],
      ['the actor', 'select actor_user_id from outbox_events'],
      ['every column', 'select * from outbox_events'],
      ['students', 'select * from students'],
      ['which modules a school has', 'select * from tenant_modules'],
      ['webhook secrets', 'select * from webhook_endpoints'],
      ['what was processed', 'select * from processed_events'],
    ])('cannot read %s', async (_what, query) => {
      expect(await failureOf(() => dispatcher.query(query))).toMatchObject(
        permissionDenied,
      );
    });

    it.each([
      [
        'insert an event',
        `insert into outbox_events (tenant_id, type, payload)
         values ('${one.id}', 'student.accepted', '{}')`,
      ],
      ['delete an event', 'delete from outbox_events'],
      ['change a payload', `update outbox_events set payload = '{}'`],
      [
        'move an event to another school',
        `update outbox_events set tenant_id = '${two.id}'`,
      ],
    ])('cannot %s', async (_what, query) => {
      expect(await failureOf(() => dispatcher.query(query))).toMatchObject(
        permissionDenied,
      );
    });

    it('marks an event dispatched once and cannot take it back', async () => {
      await withEvents();
      const id = events[one.id][0];
      const mark = await dispatcher.query(
        'update outbox_events set dispatched_at = now() where id = $1',
        [id],
      );
      expect(mark.rowCount).toBe(1);

      const unmark = await dispatcher.query(
        'update outbox_events set dispatched_at = null where id = $1',
        [id],
      );
      const again = await dispatcher.query(
        `update outbox_events set dispatched_at = now() + interval '1 day' where id = $1`,
        [id],
      );
      expect([unmark.rowCount, again.rowCount]).toEqual([0, 0]);
    });

    it('cannot write a null over an undispatched event', async () => {
      await withEvents();
      const failure = await failureOf(() =>
        dispatcher.query(
          'update outbox_events set dispatched_at = null where id = $1',
          [events[one.id][1]],
        ),
      );
      expect(failure).toMatchObject(rlsViolation);
    });
  });

  describe('app_runtime and the outbox', () => {
    it('sees no event without a school', async () => {
      const { rows } = await runtime.query('select id from outbox_events');
      expect(rows).toEqual([]);
    });

    it('sees only its school’s events', async () => {
      await withEvents();
      const rows = await inScope(
        runtime,
        { tenantId: two.id },
        async (client) =>
          (await client.query('select id, tenant_id from outbox_events')).rows,
      );
      expect(rows.map((row) => row.id).sort()).toEqual(
        [...events[two.id]].sort(),
      );
    });

    it.each([
      ['update an event', `update outbox_events set payload = '{}'`],
      ['delete an event', 'delete from outbox_events'],
      ['truncate the outbox', 'truncate outbox_events cascade'],
      [
        'insert an event that is already dispatched',
        `insert into outbox_events (type, payload, dispatched_at)
         values ('student.accepted', '{}', now())`,
      ],
      [
        'insert an event for another school',
        `insert into outbox_events (tenant_id, type, payload)
         values ('${two.id}', 'student.accepted', '{}')`,
      ],
      [
        'insert an event in another user’s name',
        `insert into outbox_events (type, payload, actor_user_id)
         values ('student.accepted', '{}', '${userEvents.id}')`,
      ],
    ])('cannot %s', async (_what, query) => {
      const failure = await failureOf(() =>
        inScope(
          runtime,
          { userId: userEvents.id, tenantId: one.id },
          (client) => client.query(query),
        ),
      );
      expect(failure).toMatchObject(permissionDenied);
    });
  });

  describe('app_queue', () => {
    it('is a plain role: no superuser, no BYPASSRLS, member of nothing', async () => {
      expect((await queue.query(attributes)).rows[0]).toEqual(plain);
      expect((await queue.query(memberOf)).rows).toEqual([]);
      const { rows } = await queue.query(
        'select current_user::text as current',
      );
      expect(rows[0].current).toBe('app_queue');
    });

    it('may use and create in its own schema and nowhere else', async () => {
      const { rows } = await queue.query(schemas);
      expect(rows).toEqual([{ name: 'pgboss', usage: true, create: true }]);
    });

    it('reaches no application table', async () => {
      const { rows } = await queue.query(reachable);
      expect(rows.filter((row) => row.schema !== 'pgboss')).toEqual([]);
      expect(
        await failureOf(() =>
          queue.query('select 1 from public.outbox_events'),
        ),
      ).toMatchObject(permissionDenied);
    });

    it('owns nothing outside its schema', async () => {
      const { rows } = await queue.query(
        `select n.nspname as schema, c.relname as name
           from pg_class c
           join pg_namespace n on n.oid = c.relnamespace
          where c.relowner = (select oid from pg_roles where rolname = current_user)
            and n.nspname <> 'pgboss'`,
      );
      expect(rows).toEqual([]);
    });
  });

  describe('the queue schema', () => {
    it('exists, so the checks on it are not empty', async () => {
      const { rows } = await runtime.query(
        `select nspname from pg_namespace where nspname = 'pgboss'`,
      );
      expect(rows).toHaveLength(1);
    });

    it('is closed to the runtime role and to the dispatcher', async () => {
      for (const pool of [runtime, dispatcher]) {
        const { rows } = await pool.query(
          `select has_schema_privilege(current_user, 'pgboss', 'USAGE') as usage,
                  has_schema_privilege(current_user, 'pgboss', 'CREATE') as "create"`,
        );
        expect(rows[0]).toEqual({ usage: false, create: false });
      }
    });
  });
});
