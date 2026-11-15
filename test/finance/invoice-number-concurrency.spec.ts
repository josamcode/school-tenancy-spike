import pg from 'pg';
import { calendarSchools } from '../../db/seed.js';
import { committed, runtimePool, sleep } from '../support/db.js';

const school = calendarSchools.numbering;
const other = calendarSchools.numberingOther;

// Two schools, written only by this file.
describe('invoice numbers under concurrency', () => {
  let pool: pg.Pool;

  beforeAll(() => {
    pool = runtimePool(12);
  });

  afterAll(async () => {
    await pool.end();
  });

  async function begin(schoolId = school.id): Promise<pg.PoolClient> {
    const client = await pool.connect();
    await client.query('begin');
    await client.query("select set_config('app.tenant_id', $1, true)", [
      schoolId,
    ]);
    return client;
  }

  async function end(client: pg.PoolClient, how: 'commit' | 'rollback') {
    try {
      await client.query(how);
    } finally {
      client.release();
    }
  }

  const insert = async (
    client: pg.PoolClient,
    studentId = school.students.latin.id,
  ) => {
    const { rows } = await client.query<{ number: string }>(
      `insert into invoices (student_id, amount, currency)
       values ($1, '100.0000', 'AED') returning number`,
      [studentId],
    );
    return Number(rows[0].number);
  };

  const insertCommitted = () =>
    committed(pool, { tenantId: school.id }, (client) => insert(client));

  it('makes a second insert wait for the first, then gives it the next number', async () => {
    const first = await begin();
    const second = await begin();
    let secondDone = false;
    try {
      const firstNumber = await insert(first);

      const waiting = insert(second).then((number) => {
        secondDone = true;
        return number;
      });
      await sleep(300);
      expect(secondDone).toBe(false);

      await end(first, 'commit');
      expect(await waiting).toBe(firstNumber + 1);
      await end(second, 'commit');
    } catch (error) {
      await end(first, 'rollback').catch(() => {});
      await end(second, 'rollback').catch(() => {});
      throw error;
    }
  });

  it('gives 20 inserts at once the next 20 numbers, with no gap and no repeat', async () => {
    const before = await insertCommitted();
    const numbers = await Promise.all(
      Array.from({ length: 20 }, () => insertCommitted()),
    );
    expect(numbers.sort((a, b) => a - b)).toEqual(
      Array.from({ length: 20 }, (_, index) => before + 1 + index),
    );
  });

  it('reuses the number of an insert that was rolled back', async () => {
    const rolledBack = await begin();
    let abandoned: number;
    try {
      abandoned = await insert(rolledBack);
    } finally {
      await end(rolledBack, 'rollback');
    }
    expect(await insertCommitted()).toBe(abandoned);
  });

  it('gives the number to whichever commits when the first rolls back', async () => {
    const first = await begin();
    const second = await begin();
    try {
      const firstNumber = await insert(first);
      const waiting = insert(second);
      await sleep(100);
      await end(first, 'rollback');
      expect(await waiting).toBe(firstNumber);
      await end(second, 'commit');
    } catch (error) {
      await end(first, 'rollback').catch(() => {});
      await end(second, 'rollback').catch(() => {});
      throw error;
    }
  });

  it('does not make another school wait', async () => {
    const holder = await begin();
    const elsewhere = await begin(other.id);
    try {
      await insert(holder);
      const started = Date.now();
      const number = await insert(elsewhere, other.students.latin.id);
      expect(Date.now() - started).toBeLessThan(250);
      expect(number).toBeGreaterThanOrEqual(1);
    } finally {
      await end(holder, 'rollback');
      await end(elsewhere, 'rollback');
    }
  });

  it('numbers each school from 1', async () => {
    const elsewhere = await begin(other.id);
    try {
      expect(await insert(elsewhere, other.students.latin.id)).toBe(1);
    } finally {
      await end(elsewhere, 'rollback');
    }
  });
});
