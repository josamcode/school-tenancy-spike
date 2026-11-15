import pg from 'pg';
import { AREAS } from '../../src/entitlements/areas.js';
import {
  PermissionKey,
  PERMISSIONS,
} from '../../src/entitlements/permissions.js';
import { ownerPool } from '../support/db.js';

// Checked by `pnpm typecheck`: an area that is not in the map does not compile.
// @ts-expect-error transport is not a declared area
const undeclaredArea: PermissionKey = 'transport:read';
void undeclaredArea;

describe('permissions and areas in code and in the database', () => {
  let owner: pg.Pool;

  beforeAll(() => {
    owner = ownerPool();
  });

  afterAll(async () => {
    await owner.end();
  });

  // The runtime role cannot read the catalogs, so these checks run as the owner.
  it('has the same permissions in the code and in the permissions table', async () => {
    const { rows } = await owner.query(
      'select key from permissions order by key',
    );
    expect(rows.map((row) => row.key)).toEqual([...PERMISSIONS].sort());
    expect(rows.length).toBeGreaterThan(0);
  });

  it('declares the area of every permission, as core or as a module', () => {
    for (const permission of PERMISSIONS) {
      const area = permission.split(':')[0];
      expect(Object.keys(AREAS)).toContain(area);
      expect(['core', 'module']).toContain(AREAS[area as keyof typeof AREAS]);
    }
  });

  it('has every module area in the modules table, and every module of the table in the map', async () => {
    const { rows } = await owner.query('select key from modules order by key');
    const moduleAreas = Object.entries(AREAS)
      .filter(([, kind]) => kind === 'module')
      .map(([area]) => area)
      .sort();
    expect(rows.map((row) => row.key)).toEqual(moduleAreas);
    expect(moduleAreas.length).toBeGreaterThan(0);
  });
});
