import pg from 'pg';
import { CURRENCIES } from '../../src/finance/money.js';
import { runtimePool } from '../support/db.js';

describe('currencies in code and in the database', () => {
  let pool: pg.Pool;

  beforeAll(() => {
    pool = runtimePool();
  });

  afterAll(async () => {
    await pool.end();
  });

  it('has the same currencies and minor units in the code and in the currencies table', async () => {
    const { rows } = await pool.query(
      'select code, minor_units from currencies order by code',
    );
    const inTable = Object.fromEntries(
      rows.map((row) => [row.code, row.minor_units]),
    );
    expect(inTable).toEqual(CURRENCIES);
    expect(rows.length).toBeGreaterThan(0);
  });
});
