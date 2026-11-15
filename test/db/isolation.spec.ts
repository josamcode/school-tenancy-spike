import pg from 'pg';
import {
  invoicesA,
  invoicesB,
  schoolA,
  schoolB,
  studentsA,
  studentsB,
  userA,
  userB,
  userBoth,
} from '../../db/seed.js';
import {
  failureOf,
  inScope,
  permissionDenied,
  rlsViolation,
  runtimePool,
} from '../support/db.js';

const allTables = [
  'tenants',
  'users',
  'memberships',
  'tenant_modules',
  'students',
  'invoices',
];

describe('tenant isolation in the database', () => {
  let pool: pg.Pool;

  beforeAll(() => {
    pool = runtimePool();
  });

  afterAll(async () => {
    await pool.end();
  });

  describe('reads with no tenant filter in the query', () => {
    it('school A sees only its own students', async () => {
      const { rows } = await inScope(pool, { tenantId: schoolA.id }, (c) =>
        c.query('select id, tenant_id from students'),
      );
      const ids = rows.map((r) => r.id);
      expect(ids).toEqual(expect.arrayContaining(studentsA.map((s) => s.id)));
      expect(rows.every((r) => r.tenant_id === schoolA.id)).toBe(true);
      for (const student of studentsB) expect(ids).not.toContain(student.id);
    });

    it('school B sees only its own students', async () => {
      const { rows } = await inScope(pool, { tenantId: schoolB.id }, (c) =>
        c.query('select id, tenant_id from students'),
      );
      const ids = rows.map((r) => r.id);
      expect(ids).toEqual(expect.arrayContaining(studentsB.map((s) => s.id)));
      expect(rows.every((r) => r.tenant_id === schoolB.id)).toBe(true);
      for (const student of studentsA) expect(ids).not.toContain(student.id);
    });

    it('school A sees only its own invoices', async () => {
      const { rows } = await inScope(pool, { tenantId: schoolA.id }, (c) =>
        c.query('select id, tenant_id from invoices'),
      );
      const ids = rows.map((r) => r.id);
      expect(ids).toEqual(expect.arrayContaining(invoicesA.map((i) => i.id)));
      expect(rows.every((r) => r.tenant_id === schoolA.id)).toBe(true);
      for (const invoice of invoicesB) expect(ids).not.toContain(invoice.id);
    });

    it('school A sees only its own module rows and its own tenant row', async () => {
      const [modules, tenants] = await inScope(
        pool,
        { tenantId: schoolA.id },
        async (c) => [
          await c.query('select tenant_id from tenant_modules'),
          await c.query('select id from tenants'),
        ],
      );
      expect(modules.rows.length).toBeGreaterThan(0);
      expect(modules.rows.every((r) => r.tenant_id === schoolA.id)).toBe(true);
      expect(tenants.rows).toEqual([{ id: schoolA.id }]);
    });

    it('a query that asks for the other school by id returns nothing', async () => {
      const { rows } = await inScope(pool, { tenantId: schoolA.id }, (c) =>
        c.query('select id from students where tenant_id = $1', [schoolB.id]),
      );
      expect(rows).toEqual([]);
    });
  });

  describe('with no tenant set', () => {
    it.each(allTables)('%s returns zero rows and no error', async (table) => {
      const { rows } = await inScope(pool, {}, (c) =>
        c.query(`select * from ${table}`),
      );
      expect(rows).toEqual([]);
    });

    it.each(allTables)(
      '%s returns zero rows and no error outside a transaction',
      async (table) => {
        const { rows } = await pool.query(`select * from ${table}`);
        expect(rows).toEqual([]);
      },
    );

    it('an insert is rejected instead of writing a row', async () => {
      const failure = await inScope(pool, {}, (c) =>
        failureOf(() =>
          c.query('insert into students (full_name) values ($1)', ['Nobody']),
        ),
      );
      expect(failure).toMatchObject(rlsViolation);
    });
  });

  describe('with a user set and no tenant', () => {
    it('the user sees only their own memberships and their own user row', async () => {
      const [memberships, users] = await inScope(
        pool,
        { userId: userA.id },
        async (c) => [
          await c.query('select tenant_id, user_id from memberships'),
          await c.query('select id from users'),
        ],
      );
      expect(memberships.rows).toEqual([
        { tenant_id: schoolA.id, user_id: userA.id },
      ]);
      expect(users.rows).toEqual([{ id: userA.id }]);
    });

    it('a user in both schools sees both memberships and nobody else', async () => {
      const { rows } = await inScope(pool, { userId: userBoth.id }, (c) =>
        c.query('select tenant_id, user_id from memberships order by 1'),
      );
      expect(rows).toEqual([
        { tenant_id: schoolA.id, user_id: userBoth.id },
        { tenant_id: schoolB.id, user_id: userBoth.id },
      ]);
    });

    it.each(['tenants', 'tenant_modules', 'students', 'invoices'])(
      '%s still returns zero rows',
      async (table) => {
        const { rows } = await inScope(pool, { userId: userB.id }, (c) =>
          c.query(`select * from ${table}`),
        );
        expect(rows).toEqual([]);
      },
    );
  });

  describe('writes', () => {
    it('school A can insert a student without naming the tenant', async () => {
      const { rows } = await inScope(pool, { tenantId: schoolA.id }, (c) =>
        c.query(
          'insert into students (full_name) values ($1) returning tenant_id',
          ['Default Tenant'],
        ),
      );
      expect(rows).toEqual([{ tenant_id: schoolA.id }]);
    });

    it('school A cannot insert a student for school B', async () => {
      const failure = await inScope(pool, { tenantId: schoolA.id }, (c) =>
        failureOf(() =>
          c.query(
            'insert into students (tenant_id, full_name) values ($1, $2)',
            [schoolB.id, 'Smuggled'],
          ),
        ),
      );
      expect(failure).toMatchObject(rlsViolation);
    });

    it('school A cannot insert an invoice for school B', async () => {
      const failure = await inScope(pool, { tenantId: schoolA.id }, (c) =>
        failureOf(() =>
          c.query(
            `insert into invoices (tenant_id, student_id, amount, currency)
             values ($1, $2, $3, $4)`,
            [schoolB.id, studentsB[0].id, '1.0000', 'AED'],
          ),
        ),
      );
      expect(failure).toMatchObject(rlsViolation);
    });

    it('an update from school A does not touch a row of school B', async () => {
      const target = studentsB[0];
      const pair = await pool.connect();
      try {
        await pair.query('begin');
        await pair.query("select set_config('app.tenant_id', $1, true)", [
          schoolA.id,
        ]);
        const update = await pair.query(
          'update students set full_name = $1 where id = $2',
          ['Overwritten', target.id],
        );
        expect(update.rowCount).toBe(0);

        await pair.query("select set_config('app.tenant_id', $1, true)", [
          schoolB.id,
        ]);
        const after = await pair.query(
          'select full_name from students where id = $1',
          [target.id],
        );
        expect(after.rows).toEqual([{ full_name: target.fullName }]);
      } finally {
        await pair.query('rollback');
        pair.release();
      }
    });

    it('school A cannot move one of its own students to school B', async () => {
      const failure = await inScope(pool, { tenantId: schoolA.id }, (c) =>
        failureOf(() =>
          c.query('update students set tenant_id = $1 where id = $2', [
            schoolB.id,
            studentsA[0].id,
          ]),
        ),
      );
      expect(failure).toMatchObject(rlsViolation);
    });

    it('school A cannot move one of its own invoices to school B', async () => {
      const failure = await inScope(pool, { tenantId: schoolA.id }, (c) =>
        failureOf(() =>
          c.query('update invoices set tenant_id = $1 where id = $2', [
            schoolB.id,
            invoicesA[0].id,
          ]),
        ),
      );
      expect(failure).toMatchObject(rlsViolation);
    });

    it.each(['tenants', 'users', 'memberships', 'tenant_modules'])(
      'the runtime role cannot insert into %s',
      async (table) => {
        const failure = await inScope(pool, { tenantId: schoolA.id }, (c) =>
          failureOf(() => c.query(`insert into ${table} default values`)),
        );
        expect(failure).toMatchObject(permissionDenied);
      },
    );

    it.each(allTables)(
      'the runtime role cannot delete from %s',
      async (table) => {
        const failure = await inScope(pool, { tenantId: schoolA.id }, (c) =>
          failureOf(() => c.query(`delete from ${table}`)),
        );
        expect(failure).toMatchObject(permissionDenied);
      },
    );
  });

  describe('a pool with one connection', () => {
    let single: pg.Pool;

    beforeAll(() => {
      single = runtimePool(1);
    });

    afterAll(async () => {
      await single.end();
    });

    it('a transaction for school A followed by one with no tenant returns zero rows and no error', async () => {
      const first = await single.connect();
      let firstPid: number;
      try {
        firstPid = (await first.query('select pg_backend_pid() as pid')).rows[0]
          .pid;
        await first.query('begin');
        await first.query("select set_config('app.tenant_id', $1, true)", [
          schoolA.id,
        ]);
        const seen = await first.query('select id from students');
        expect(seen.rows.length).toBeGreaterThan(0);
      } finally {
        await first.query('commit');
        first.release();
      }

      const second = await single.connect();
      try {
        const secondPid = (await second.query('select pg_backend_pid() as pid'))
          .rows[0].pid;
        expect(secondPid).toBe(firstPid);

        await second.query('begin');
        const leftover = await second.query(
          "select current_setting('app.tenant_id', true) as value",
        );
        const inTransaction = await second.query('select id from students');
        await second.query('commit');
        const bare = await second.query('select id from invoices');

        expect(leftover.rows).toEqual([{ value: '' }]);
        expect(inTransaction.rows).toEqual([]);
        expect(bare.rows).toEqual([]);
      } finally {
        second.release();
      }
    });
  });
});
