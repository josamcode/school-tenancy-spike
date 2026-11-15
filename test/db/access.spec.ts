import pg from 'pg';
import {
  grants,
  schoolA,
  schoolB,
  userA,
  userGroupAdmin,
} from '../../db/seed.js';
import {
  failureOf,
  foreignKeyViolation,
  inScope,
  ownerPool,
  permissionDenied,
  runtimePool,
} from '../support/db.js';

const notIn = (table: string) => ({
  ...foreignKeyViolation,
  detail: expect.stringContaining(`is not present in table "${table}"`),
});

describe('access tables', () => {
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

  describe('the runtime role', () => {
    it.each([
      'memberships',
      'grants',
      'role_permissions',
      'groups',
      'group_schools',
      'group_admins',
      'permissions',
      'roles',
    ])('cannot insert into %s', async (table) => {
      const failure = await inScope(
        runtime,
        { userId: userA.id, tenantId: schoolA.id },
        (client) =>
          failureOf(() => client.query(`insert into ${table} default values`)),
      );
      expect(failure).toMatchObject(permissionDenied);
    });

    it.each(['memberships', 'grants', 'role_permissions'])(
      'cannot delete from %s',
      async (table) => {
        const failure = await inScope(
          runtime,
          { userId: userA.id, tenantId: schoolA.id },
          (client) => failureOf(() => client.query(`delete from ${table}`)),
        );
        expect(failure).toMatchObject(permissionDenied);
      },
    );

    it('cannot change its own role', async () => {
      const failure = await inScope(
        runtime,
        { userId: userA.id, tenantId: schoolA.id },
        (client) =>
          failureOf(() =>
            client.query('update memberships set role = $1', ['school_admin']),
          ),
      );
      expect(failure).toMatchObject(permissionDenied);
    });

    it.each([
      'permissions',
      'roles',
      'groups',
      'group_schools',
      'group_admins',
    ])('cannot read %s', async (table) => {
      const failure = await failureOf(() =>
        runtime.query(`select * from ${table}`),
      );
      expect(failure).toMatchObject(permissionDenied);
    });

    it('can read which permissions a role has', async () => {
      const { rows } = await runtime.query(
        'select permission from role_permissions where role = $1',
        ['staff'],
      );
      expect(rows).toEqual([{ permission: 'students:read' }]);
    });
  });

  describe('grants', () => {
    const adminGrant = grants.find((g) => g.userId === userGroupAdmin.id)!;

    it('shows a user their own grants and nobody else’s', async () => {
      const { rows } = await inScope(
        runtime,
        { userId: userGroupAdmin.id },
        (client) =>
          client.query('select tenant_id, user_id, permission from grants'),
      );
      expect(rows).toEqual([
        {
          tenant_id: adminGrant.tenantId,
          user_id: userGroupAdmin.id,
          permission: adminGrant.permission,
        },
      ]);
    });

    it('returns zero rows with no user set, even with the tenant set', async () => {
      const none = await inScope(runtime, {}, (client) =>
        client.query('select * from grants'),
      );
      const tenantOnly = await inScope(
        runtime,
        { tenantId: schoolB.id },
        (client) => client.query('select * from grants'),
      );
      expect(none.rows).toEqual([]);
      expect(tenantOnly.rows).toEqual([]);
    });

    it('returns zero rows to a user who holds none', async () => {
      const { rows } = await inScope(runtime, { userId: userA.id }, (client) =>
        client.query('select * from grants'),
      );
      expect(rows).toEqual([]);
    });
  });

  // Only the owner can write these tables, so the catalog checks run as the owner.
  describe('catalogs', () => {
    it('rejects a grant for a misspelt permission', async () => {
      const failure = await inScope(owner, {}, (client) =>
        failureOf(() =>
          client.query(
            'insert into grants (tenant_id, user_id, permission) values ($1, $2, $3)',
            [schoolA.id, userGroupAdmin.id, 'student:read'],
          ),
        ),
      );
      expect(failure).toMatchObject(notIn('permissions'));
    });

    it('rejects a role permission for a misspelt permission', async () => {
      const failure = await inScope(owner, {}, (client) =>
        failureOf(() =>
          client.query(
            'insert into role_permissions (role, permission) values ($1, $2)',
            ['staff', 'students:raed'],
          ),
        ),
      );
      expect(failure).toMatchObject(notIn('permissions'));
    });

    it('rejects a role permission for a role that does not exist', async () => {
      const failure = await inScope(owner, {}, (client) =>
        failureOf(() =>
          client.query(
            'insert into role_permissions (role, permission) values ($1, $2)',
            ['accountant', 'students:read'],
          ),
        ),
      );
      expect(failure).toMatchObject(notIn('roles'));
    });

    it('rejects a membership with a role that does not exist', async () => {
      const failure = await inScope(owner, {}, (client) =>
        failureOf(() =>
          client.query(
            'insert into memberships (tenant_id, user_id, role) values ($1, $2, $3)',
            [schoolA.id, userGroupAdmin.id, 'School_Admin'],
          ),
        ),
      );
      expect(failure).toMatchObject(notIn('roles'));
    });

    it('gives school_admin every permission in the permissions table', async () => {
      const { rows } = await owner.query(
        `select key from permissions
         except
         select permission from role_permissions where role = 'school_admin'`,
      );
      expect(rows).toEqual([]);
    });

    it('gives staff exactly students:read', async () => {
      const { rows } = await owner.query(
        `select permission from role_permissions where role = 'staff'`,
      );
      expect(rows).toEqual([{ permission: 'students:read' }]);
    });
  });
});
