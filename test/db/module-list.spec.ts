import pg from 'pg';
import { MODULES } from '../../src/entitlements/modules.js';
import { ownerPool } from '../support/db.js';

describe('module names', () => {
  let owner: pg.Pool;

  beforeAll(() => {
    owner = ownerPool();
  });

  afterAll(async () => {
    await owner.end();
  });

  // The runtime role cannot read the catalog, so this check runs as the owner.
  it('are the same in the code and in the modules table', async () => {
    const { rows } = await owner.query('select key from modules order by key');
    expect(rows.map((row) => row.key)).toEqual([...MODULES].sort());
    expect(rows.length).toBeGreaterThan(0);
  });
});
