import pg from 'pg';
import { schoolA, studentsB, userA } from '../../db/seed.js';
import {
  failureOf,
  foreignKeyViolation,
  inScope,
  ownerPool,
  permissionDenied,
  runtimePool,
  uniqueViolation,
} from '../support/db.js';

describe('constraints on tenant-owned tables', () => {
  let pool: pg.Pool;

  beforeAll(() => {
    pool = runtimePool();
  });

  afterAll(async () => {
    await pool.end();
  });

  it('finds the tenant-owned tables, so the checks below are not empty', async () => {
    const { rows } = await pool.query(
      `select c.relname
         from pg_class c
         join pg_namespace n on n.oid = c.relnamespace
         join pg_attribute a on a.attrelid = c.oid and a.attname = 'tenant_id'
        where n.nspname = 'public' and c.relkind = 'r'
        order by 1`,
    );
    expect(rows.map((r) => r.relname)).toEqual(
      expect.arrayContaining([
        'invoices',
        'memberships',
        'students',
        'tenant_modules',
      ]),
    );
  });

  it('every tenant_id column is NOT NULL', async () => {
    const { rows } = await pool.query(
      `select c.relname
         from pg_class c
         join pg_namespace n on n.oid = c.relnamespace
         join pg_attribute a on a.attrelid = c.oid and a.attname = 'tenant_id'
        where n.nspname = 'public' and c.relkind = 'r' and not a.attnotnull`,
    );
    expect(rows).toEqual([]);
  });

  it('every primary key, unique constraint and unique index includes tenant_id', async () => {
    const { rows } = await pool.query(
      `select c.relname as table, i.relname as index
         from pg_index x
         join pg_class c on c.oid = x.indrelid
         join pg_class i on i.oid = x.indexrelid
         join pg_namespace n on n.oid = c.relnamespace
         join pg_attribute t on t.attrelid = c.oid and t.attname = 'tenant_id'
        where n.nspname = 'public'
          and x.indisunique
          and not (t.attnum = any (x.indkey::int2[]))`,
    );
    expect(rows).toEqual([]);
  });

  it('every foreign key between two tenant-owned tables includes tenant_id on both sides', async () => {
    const { rows } = await pool.query(
      `select con.conname, src.relname as from_table, dst.relname as to_table
         from pg_constraint con
         join pg_class src on src.oid = con.conrelid
         join pg_class dst on dst.oid = con.confrelid
         join pg_namespace n on n.oid = src.relnamespace
         join pg_attribute st on st.attrelid = src.oid and st.attname = 'tenant_id'
         join pg_attribute dt on dt.attrelid = dst.oid and dt.attname = 'tenant_id'
        where n.nspname = 'public'
          and con.contype = 'f'
          and not (st.attnum = any (con.conkey) and dt.attnum = any (con.confkey))`,
    );
    expect(rows).toEqual([]);
  });

  it('has at least one such foreign key, so the check above is not empty', async () => {
    const { rows } = await pool.query(
      `select con.conname
         from pg_constraint con
         join pg_class src on src.oid = con.conrelid
         join pg_class dst on dst.oid = con.confrelid
         join pg_attribute st on st.attrelid = src.oid and st.attname = 'tenant_id'
         join pg_attribute dt on dt.attrelid = dst.oid and dt.attname = 'tenant_id'
        where con.contype = 'f'
          and src.relname = 'invoices'
          and dst.relname = 'students'`,
    );
    expect(rows).toHaveLength(1);
  });

  it('rejects an invoice in school A that points at a student of school B', async () => {
    const failure = await inScope(pool, { tenantId: schoolA.id }, (client) =>
      failureOf(() =>
        client.query(
          `insert into invoices (student_id, amount, currency)
           values ($1, $2, $3)`,
          [studentsB[0].id, '100.0000', 'AED'],
        ),
      ),
    );
    expect(failure).toMatchObject(foreignKeyViolation);
  });

  it('rejects an invoice for a student that does not exist', async () => {
    const failure = await inScope(pool, { tenantId: schoolA.id }, (client) =>
      failureOf(() =>
        client.query(
          `insert into invoices (student_id, amount, currency)
           values ($1, $2, $3)`,
          ['00000000-0000-4000-8000-00000000dead', '100.0000', 'AED'],
        ),
      ),
    );
    expect(failure).toMatchObject(foreignKeyViolation);
  });
});

describe('user email uniqueness', () => {
  let owner: pg.Pool;
  let runtime: pg.Pool;

  beforeAll(() => {
    owner = ownerPool();
    runtime = runtimePool();
  });

  afterAll(async () => {
    await owner.end();
    await runtime.end();
  });

  // The runtime role cannot insert users, so this one check runs as the owner.
  it('rejects a second user whose email differs only by letter case', async () => {
    const failure = await inScope(owner, {}, (client) =>
      failureOf(() =>
        client.query('insert into users (email) values ($1)', [
          userA.email.toUpperCase(),
        ]),
      ),
    );
    expect(failure).toMatchObject(uniqueViolation);
  });

  it('does not let the runtime role insert users at all', async () => {
    const failure = await inScope(runtime, {}, (client) =>
      failureOf(() =>
        client.query('insert into users (email) values ($1)', [
          'someone.new@schools.test',
        ]),
      ),
    );
    expect(failure).toMatchObject(permissionDenied);
  });
});
