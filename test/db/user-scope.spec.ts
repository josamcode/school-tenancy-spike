import { sql } from 'drizzle-orm';
import pg from 'pg';
import {
  grants,
  schoolA,
  schoolB,
  schoolD,
  schoolH,
  userA,
  userBoth,
  userGroupAdmin,
  userStaffDGrantH,
} from '../../db/seed.js';
import { TenantDb } from '../../src/db/tenant-db.js';
import { ownerPool, runtimePool } from '../support/db.js';

// A transaction that knows who is asking and no school. Schools that
// nothing writes.
describe('a transaction for a user with no school', () => {
  let pool: pg.Pool;
  let owner: pg.Pool;
  let tenantDb: TenantDb;

  const rows = <R extends Record<string, unknown>>(
    user: { id: string },
    query: ReturnType<typeof sql>,
  ) =>
    tenantDb.runForUser(
      user.id,
      async () => (await tenantDb.db.execute<R>(query)).rows,
    );

  beforeAll(() => {
    pool = runtimePool(1);
    owner = ownerPool();
    tenantDb = new TenantDb(pool);
  });

  afterAll(async () => {
    await pool.end();
    await owner.end();
  });

  it('sets the user and leaves the school unset', async () => {
    const [settings] = await rows<{ user: string; school: string | null }>(
      userBoth,
      sql`select current_setting('app.user_id', true) as user,
                 nullif(current_setting('app.tenant_id', true), '') as school`,
    );
    expect(settings).toEqual({ user: userBoth.id, school: null });
  });

  it('sees the memberships of that user and of no one else', async () => {
    const both = await rows(
      userBoth,
      sql`select tenant_id, user_id from memberships order by tenant_id`,
    );
    expect(both).toEqual([
      { tenant_id: schoolA.id, user_id: userBoth.id },
      { tenant_id: schoolB.id, user_id: userBoth.id },
    ]);

    // Other people are members of the same schools.
    const others = await owner.query(
      'select count(*)::int as n from memberships where tenant_id = $1 and user_id <> $2',
      [schoolA.id, userBoth.id],
    );
    expect(others.rows[0].n).toBeGreaterThan(0);
  });

  it('sees the grants of that user and of no one else', async () => {
    expect(
      await rows(userGroupAdmin, sql`select tenant_id, permission from grants`),
    ).toEqual([{ tenant_id: schoolB.id, permission: 'students:read' }]);
    expect(
      await rows(
        userStaffDGrantH,
        sql`select tenant_id, permission from grants`,
      ),
    ).toEqual([{ tenant_id: schoolH.id, permission: 'students:create' }]);
    expect(await rows(userBoth, sql`select 1 from grants`)).toEqual([]);
    expect(grants.length).toBeGreaterThan(1);
  });

  it('sees a membership and a grant of the same user in different schools', async () => {
    expect(
      await rows(
        userStaffDGrantH,
        sql`select tenant_id, role from memberships`,
      ),
    ).toEqual([{ tenant_id: schoolD.id, role: 'staff' }]);
  });

  it('sees only that user in the users table', async () => {
    expect(await rows(userA, sql`select id from users`)).toEqual([
      { id: userA.id },
    ]);
  });

  it('sees no row of any table that belongs to a school', async () => {
    // Every table whose policy looks at the school, read from the catalog.
    const { rows: tables } = await owner.query<{ tablename: string }>(
      `select distinct tablename from pg_policies
        where schemaname = 'public'
          and qual like '%app.tenant_id%'
          and has_table_privilege('app_runtime', format('public.%I', tablename), 'SELECT')
        order by tablename`,
    );
    const names = tables.map((table) => table.tablename);
    expect(names).toEqual(
      expect.arrayContaining([
        'students',
        'invoices',
        'tenants',
        'tenant_modules',
        'ledger_lines',
        'outbox_events',
        'admission_applications',
      ]),
    );

    for (const name of names) {
      const [{ n }] = await rows<{ n: number }>(
        userA,
        sql`select count(*)::int as n from ${sql.identifier(name)}`,
      );
      expect(`${name}: ${n}`).toBe(`${name}: 0`);
    }

    // The same user does see their school's students once the school is set.
    const students = await tenantDb.run(
      userA.id,
      schoolA.id,
      async () =>
        (
          await tenantDb.db.execute(
            sql`select count(*)::int as n from students`,
          )
        ).rows,
    );
    expect(students[0].n).toBeGreaterThan(0);
  });

  it('leaves nothing set on the connection afterwards', async () => {
    await rows(userA, sql`select 1`);
    // The pool has one connection, so this is the one that was just used.
    const { rows: after } = await pool.query(
      `select nullif(current_setting('app.user_id', true), '') as user,
              nullif(current_setting('app.tenant_id', true), '') as school`,
    );
    expect(after).toEqual([{ user: null, school: null }]);
  });

  it('rolls back and fails the caller when the work throws', async () => {
    await expect(
      tenantDb.runForUser(userA.id, async () => {
        throw new Error('stop');
      }),
    ).rejects.toThrow('stop');
    const { rows: after } = await pool.query(
      "select nullif(current_setting('app.user_id', true), '') as user",
    );
    expect(after).toEqual([{ user: null }]);
  });
});
