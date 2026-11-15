import pg from 'pg';
import { runtimePool } from '../support/db.js';

describe('runtime role', () => {
  let pool: pg.Pool;

  beforeAll(() => {
    pool = runtimePool();
  });

  afterAll(async () => {
    await pool.end();
  });

  it('is the role the tests connect as', async () => {
    const { rows } = await pool.query(
      'select current_user::text as current, session_user::text as session',
    );
    expect(rows[0]).toEqual({ current: 'app_runtime', session: 'app_runtime' });
  });

  it('is not a superuser and cannot bypass row-level security', async () => {
    const { rows } = await pool.query(
      `select rolsuper, rolbypassrls, rolcreaterole, rolcreatedb, rolreplication
         from pg_roles where rolname = current_user`,
    );
    expect(rows[0]).toEqual({
      rolsuper: false,
      rolbypassrls: false,
      rolcreaterole: false,
      rolcreatedb: false,
      rolreplication: false,
    });
  });

  it('is a member of no other role', async () => {
    const { rows } = await pool.query(
      `select r.rolname
         from pg_auth_members m
         join pg_roles r on r.oid = m.roleid
        where m.member = (select oid from pg_roles where rolname = current_user)`,
    );
    expect(rows).toEqual([]);
  });

  it('owns no relation and no schema', async () => {
    const relations = await pool.query(
      `select c.relname
         from pg_class c
        where c.relowner = (select oid from pg_roles where rolname = current_user)`,
    );
    const schemas = await pool.query(
      `select nspname
         from pg_namespace
        where nspowner = (select oid from pg_roles where rolname = current_user)`,
    );
    expect(relations.rows).toEqual([]);
    expect(schemas.rows).toEqual([]);
  });

  it('cannot create a relation anywhere, including temporary ones', async () => {
    const schemas = await pool.query(
      `select nspname
         from pg_namespace
        where nspname !~ '^pg_'
          and nspname <> 'information_schema'
          and has_schema_privilege(current_user, oid, 'CREATE')`,
    );
    const database = await pool.query(
      `select has_database_privilege(current_user, current_database(), 'CREATE') as "create",
              has_database_privilege(current_user, current_database(), 'TEMPORARY') as "temporary"`,
    );
    expect(schemas.rows).toEqual([]);
    expect(database.rows[0]).toEqual({ create: false, temporary: false });
  });
});
