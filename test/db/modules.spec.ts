import pg from 'pg';
import { schoolC } from '../../db/seed.js';
import {
  failureOf,
  foreignKeyViolation,
  inScope,
  ownerPool,
  permissionDenied,
  runtimePool,
} from '../support/db.js';

// A missing school is also a foreign key violation, so the detail must name the catalog.
const notInCatalog = {
  ...foreignKeyViolation,
  detail: expect.stringContaining('is not present in table "modules"'),
};

describe('modules catalog', () => {
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

  // Only the owner can write tenant_modules, so these two checks run as the owner.
  it('rejects a tenant_modules row for a module that is not in the catalog', async () => {
    const failure = await inScope(owner, { tenantId: schoolC.id }, (client) =>
      failureOf(() =>
        client.query(
          'insert into tenant_modules (module, enabled) values ($1, true)',
          ['fnance'],
        ),
      ),
    );
    expect(failure).toMatchObject(notInCatalog);
  });

  it('rejects a module name that differs only by letter case', async () => {
    const failure = await inScope(owner, { tenantId: schoolC.id }, (client) =>
      failureOf(() =>
        client.query(
          'insert into tenant_modules (module, enabled) values ($1, true)',
          ['Finance'],
        ),
      ),
    );
    expect(failure).toMatchObject(notInCatalog);
  });

  it('gives the runtime role no access to the catalog', async () => {
    const failure = await failureOf(() =>
      runtime.query('select key from modules'),
    );
    expect(failure).toMatchObject(permissionDenied);
  });

  it('does not let the runtime role switch a module on', async () => {
    const failure = await inScope(runtime, { tenantId: schoolC.id }, (client) =>
      failureOf(() => client.query('update tenant_modules set enabled = true')),
    );
    expect(failure).toMatchObject(permissionDenied);
  });
});
