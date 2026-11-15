import pg from 'pg';
import { runtimePool } from '../support/db.js';

interface Reachable {
  schema: string;
  name: string;
  kind: string;
  enabled: boolean;
  forced: boolean;
  policies: number;
}

describe('what the runtime role can reach', () => {
  let pool: pg.Pool;
  let reachable: Reachable[];

  beforeAll(async () => {
    pool = runtimePool();
    const { rows } = await pool.query<Reachable>(
      `select n.nspname as schema,
              c.relname as name,
              c.relkind::text as kind,
              c.relrowsecurity as enabled,
              c.relforcerowsecurity as forced,
              (select count(*)::int
                 from pg_policies p
                where p.schemaname = n.nspname
                  and p.tablename = c.relname) as policies
         from pg_class c
         join pg_namespace n on n.oid = c.relnamespace
        where c.relkind in ('r', 'p', 'v', 'm', 'f')
          and n.nspname !~ '^pg_'
          and n.nspname <> 'information_schema'
          and (has_table_privilege(current_user, c.oid,
                 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
               or has_any_column_privilege(current_user, c.oid,
                 'SELECT, INSERT, UPDATE, REFERENCES'))
        order by 1, 2`,
    );
    reachable = rows;
  });

  afterAll(async () => {
    await pool.end();
  });

  it('includes the application tables, so the checks below are not empty', () => {
    expect(reachable.map((r) => r.name)).toEqual(
      expect.arrayContaining([
        'tenants',
        'users',
        'memberships',
        'tenant_modules',
        'students',
        'invoices',
      ]),
    );
  });

  it('is only ordinary tables with row-level security enabled and forced and a policy', () => {
    const unprotected = reachable.filter(
      (r) =>
        !['r', 'p'].includes(r.kind) ||
        !r.enabled ||
        !r.forced ||
        r.policies < 1,
    );
    expect(unprotected).toEqual([]);
  });

  it('is nothing outside the public schema', () => {
    expect(reachable.filter((r) => r.schema !== 'public')).toEqual([]);
  });

  it('has no access to any other schema', async () => {
    const { rows } = await pool.query(
      `select nspname
         from pg_namespace
        where nspname !~ '^pg_'
          and nspname not in ('information_schema', 'public')
          and (has_schema_privilege(current_user, oid, 'USAGE')
               or has_schema_privilege(current_user, oid, 'CREATE'))`,
    );
    expect(rows).toEqual([]);
  });

  it('sees that tool-owned schemas exist, so the check above is not empty', async () => {
    const { rows } = await pool.query(
      `select nspname from pg_namespace where nspname = 'drizzle'`,
    );
    expect(rows).toHaveLength(1);
  });
});
