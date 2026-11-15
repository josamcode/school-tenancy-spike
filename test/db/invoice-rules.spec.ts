import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { calendarSchools, hijriOverrides } from '../../db/seed.js';
import {
  checkViolation,
  failureOf,
  foreignKeyViolation,
  inScope,
  ownerPool,
  permissionDenied,
  refused,
  runtimePool,
  uniqueViolation,
} from '../support/db.js';

const school = calendarSchools.rules;
const student = school.students.latin.id;

interface InvoiceRow {
  number: string;
  issued_at: Date;
  issue_date: string;
}

// One school, in Asia/Dubai. Every test here rolls its writes back.
describe('what the database decides about an invoice', () => {
  let runtime: pg.Pool;
  let owner: pg.Pool;

  beforeAll(() => {
    runtime = runtimePool();
    owner = ownerPool();
  });

  afterAll(async () => {
    await runtime.end();
    await owner.end();
  });

  const inSchool = <T>(
    pool: pg.Pool,
    fn: (client: pg.PoolClient) => Promise<T>,
  ) => inScope(pool, { tenantId: school.id }, fn);

  const insert = async (
    client: pg.PoolClient,
    columns = '',
    values = '',
    parameters: unknown[] = [],
  ) => {
    const { rows } = await client.query<InvoiceRow>(
      `insert into invoices (student_id, amount, currency${columns})
       values ($1, '100.0000', 'AED'${values})
       returning number, issued_at, issue_date::text`,
      [student, ...parameters],
    );
    return rows[0];
  };

  describe('the number', () => {
    it('is assigned on insert and goes up by one', async () => {
      const numbers = await inSchool(runtime, async (client) => [
        Number((await insert(client)).number),
        Number((await insert(client)).number),
        Number((await insert(client)).number),
      ]);
      expect(numbers[0]).toBeGreaterThanOrEqual(1);
      expect(numbers).toEqual([numbers[0], numbers[0] + 1, numbers[0] + 2]);
    });

    it('cannot be supplied by the application', async () => {
      const failure = await inSchool(runtime, (client) =>
        failureOf(() => insert(client, ', number', ', 900')),
      );
      expect(failure).toMatchObject(permissionDenied);
    });

    it('is the next one even when the owner supplies another', async () => {
      const numbers = await inSchool(owner, async (client) => [
        Number((await insert(client)).number),
        Number((await insert(client, ', number', ', 900')).number),
      ]);
      expect(numbers[1]).toBe(numbers[0] + 1);
    });

    it('is unique within a school', async () => {
      const { rows } = await runtime.query<{ columns: string[] }>(
        `select array_agg(a.attname::text order by a.attname) as columns
           from pg_index x
           join pg_class c on c.oid = x.indrelid
           join pg_attribute a on a.attrelid = c.oid and a.attnum = any (x.indkey)
          where c.relname = 'invoices' and x.indisunique and not x.indisprimary
          group by x.indexrelid`,
      );
      expect(rows.map((row) => row.columns)).toContainEqual([
        'number',
        'tenant_id',
      ]);
    });

    it.each(['runtime', 'owner'] as const)(
      'cannot be changed afterwards by the %s role',
      async (role) => {
        const failure = await inSchool(
          role === 'runtime' ? runtime : owner,
          async (client) => {
            const { number } = await insert(client);
            return failureOf(() =>
              client.query(
                'update invoices set number = $1 where number = $2',
                [Number(number) + 50, number],
              ),
            );
          },
        );
        expect(failure).toMatchObject(
          refused('number and issue date cannot be changed'),
        );
      },
    );
  });

  describe('the issue date', () => {
    it('is today in the school’s timezone, from the database clock', async () => {
      const result = await inSchool(runtime, async (client) => {
        const row = await insert(client);
        const { rows } = await client.query<{ today: string; now: Date }>(
          `select (clock_timestamp() at time zone 'Asia/Dubai')::date::text as today,
                  clock_timestamp() as now`,
        );
        return { row, ...rows[0] };
      });
      expect(result.row.issue_date).toBe(result.today);
      const age = result.now.getTime() - result.row.issued_at.getTime();
      expect(age).toBeGreaterThanOrEqual(0);
      expect(age).toBeLessThan(5000);
    });

    it.each([
      ['issued_at', "'2020-01-01T00:00:00Z'"],
      ['issue_date', "'2020-01-01'"],
    ])('cannot be set by the application through %s', async (column, value) => {
      const failure = await inSchool(runtime, (client) =>
        failureOf(() => insert(client, `, ${column}`, `, ${value}`)),
      );
      expect(failure).toMatchObject(permissionDenied);
    });

    it('follows a past issued_at that the owner supplies, in the school’s timezone, with the next number', async () => {
      // 21:30 UTC on 31 December is 01:30 on 1 January in Dubai.
      const result = await inSchool(owner, async (client) => {
        const before = await insert(client);
        const imported = await insert(client, ', issued_at', ', $2', [
          '2024-12-31T21:30:00Z',
        ]);
        return { before, imported };
      });
      expect(result.imported.issued_at.toISOString()).toBe(
        '2024-12-31T21:30:00.000Z',
      );
      expect(result.imported.issue_date).toBe('2025-01-01');
      expect(Number(result.imported.number)).toBe(
        Number(result.before.number) + 1,
      );
    });

    it('is derived, whatever issue_date the owner supplies', async () => {
      const row = await inSchool(owner, (client) =>
        insert(client, ', issued_at, issue_date', ', $2, $3', [
          '2024-12-31T21:30:00Z',
          '2019-05-05',
        ]),
      );
      expect(row.issue_date).toBe('2025-01-01');
    });

    it.each(['issued_at', 'issue_date'])(
      'cannot be changed afterwards through %s',
      async (column) => {
        for (const pool of [runtime, owner]) {
          const failure = await inSchool(pool, async (client) => {
            const { number } = await insert(client);
            return failureOf(() =>
              client.query(
                `update invoices set ${column} = '2020-01-01' where number = $1`,
                [number],
              ),
            );
          });
          expect(failure).toMatchObject(
            refused('number and issue date cannot be changed'),
          );
        }
      },
    );

    it('still lets the amount of an unposted invoice change', async () => {
      const amount = await inSchool(runtime, async (client) => {
        const { number } = await insert(client);
        const { rows } = await client.query<{ amount: string }>(
          `update invoices set amount = '250.0000' where number = $1
           returning amount`,
          [number],
        );
        return rows[0].amount;
      });
      expect(amount).toBe('250.0000');
    });
  });

  describe('the due date', () => {
    it('may be the issue date or later', async () => {
      const failure = await inSchool(runtime, (client) =>
        failureOf(() =>
          insert(
            client,
            ', due_date',
            ", (clock_timestamp() at time zone 'Asia/Dubai')::date",
          ),
        ),
      );
      expect(failure).toBeNull();
    });

    it('cannot be before the issue date', async () => {
      const failure = await inSchool(runtime, (client) =>
        failureOf(() => insert(client, ', due_date', ", '2001-01-01'")),
      );
      expect(failure).toMatchObject(checkViolation);
    });
  });

  describe('translated text', () => {
    const valid = [{ ar: 'رسوم', en: 'Fees' }, { ar: 'رسوم' }, { en: 'Fees' }];
    const invalid = [
      {},
      [],
      'Fees',
      { fr: 'Frais' },
      { ar: 'رسوم', fr: 'Frais' },
      { ar: '' },
      { en: '   ' },
      { ar: 1 },
      { ar: null },
    ];

    it.each(valid)('accepts %j as an invoice description', async (text) => {
      const failure = await inSchool(runtime, (client) =>
        failureOf(() =>
          insert(client, ', description', ', $2', [JSON.stringify(text)]),
        ),
      );
      expect(failure).toBeNull();
    });

    it.each(invalid)('refuses %j as an invoice description', async (text) => {
      const failure = await inSchool(runtime, (client) =>
        failureOf(() =>
          insert(client, ', description', ', $2', [JSON.stringify(text)]),
        ),
      );
      expect(failure).toMatchObject(checkViolation);
    });

    const insertTenant = (nameI18n: unknown) =>
      inScope(owner, {}, (client) =>
        failureOf(() =>
          client.query(
            `insert into tenants (id, name, timezone, name_i18n)
             values ($1, 'Translated School', 'Asia/Dubai', $2)`,
            [randomUUID(), JSON.stringify(nameI18n)],
          ),
        ),
      );

    it.each(valid)('accepts %j as a school name', async (text) => {
      expect(await insertTenant(text)).toBeNull();
    });

    it.each(invalid)('refuses %j as a school name', async (text) => {
      expect(await insertTenant(text)).toMatchObject(checkViolation);
    });
  });

  describe('a school’s country', () => {
    const insertTenant = (country: string | null) =>
      inScope(owner, {}, (client) =>
        failureOf(() =>
          client.query(
            `insert into tenants (id, name, timezone, country)
             values ($1, 'Country School', 'Asia/Dubai', $2)`,
            [randomUUID(), country],
          ),
        ),
      );

    it('is one of the six in the catalog', async () => {
      const { rows } = await runtime.query<{ code: string }>(
        'select code from countries order by code',
      );
      expect(rows.map((row) => row.code)).toEqual([
        'AE',
        'BH',
        'KW',
        'OM',
        'QA',
        'SA',
      ]);
    });

    it.each(['AE', 'SA', null])('accepts %s', async (country) => {
      expect(await insertTenant(country)).toBeNull();
    });

    it.each(['XX', 'ae'])('refuses %s', async (country) => {
      expect(await insertTenant(country)).toMatchObject(foreignKeyViolation);
    });

    it('is readable by the application for its own school only', async () => {
      const rows = await inSchool(
        runtime,
        async (client) =>
          (await client.query('select country, name_i18n from tenants')).rows,
      );
      expect(rows).toEqual([{ country: 'AE', name_i18n: null }]);
    });
  });

  describe('official Hijri month starts', () => {
    it('are readable by the application, for every country', async () => {
      const { rows } = await runtime.query(
        `select country, hijri_year, hijri_month, starts_on::text
           from hijri_month_overrides
          order by country`,
      );
      expect(rows).toEqual(
        [...hijriOverrides]
          .sort((a, b) => a.country.localeCompare(b.country))
          .map((row) => ({
            country: row.country,
            hijri_year: row.hijriYear,
            hijri_month: row.hijriMonth,
            starts_on: row.startsOn,
          })),
      );
    });

    it.each([
      [
        'insert',
        `insert into hijri_month_overrides (country, hijri_year, hijri_month, starts_on)
         values ('AE', 1447, 1, '2025-06-27')`,
      ],
      [
        'update',
        `update hijri_month_overrides set starts_on = '2025-04-01'
          where country = 'OM'`,
      ],
      ['delete', `delete from hijri_month_overrides where country = 'OM'`],
      ['truncate', 'truncate hijri_month_overrides'],
    ])('cannot be changed by the application: %s', async (_, statement) => {
      const failure = await inSchool(runtime, (client) =>
        failureOf(() => client.query(statement)),
      );
      expect(failure).toMatchObject(permissionDenied);
    });

    const insertOverride = (
      country: string,
      year: number,
      month: number,
      startsOn = '2025-06-27',
    ) =>
      inScope(owner, {}, (client) =>
        failureOf(() =>
          client.query(
            `insert into hijri_month_overrides (country, hijri_year, hijri_month, starts_on)
             values ($1, $2, $3, $4)`,
            [country, year, month, startsOn],
          ),
        ),
      );

    it('are written by the owner', async () => {
      expect(await insertOverride('AE', 1447, 1)).toBeNull();
    });

    it('name a country in the catalog', async () => {
      expect(await insertOverride('XX', 1447, 1)).toMatchObject(
        foreignKeyViolation,
      );
    });

    it.each([0, 13])('refuse month %i', async (month) => {
      expect(await insertOverride('AE', 1447, month)).toMatchObject(
        checkViolation,
      );
    });

    it.each([1299, 1601])('refuse year %i', async (year) => {
      expect(await insertOverride('AE', year, 1)).toMatchObject(checkViolation);
    });

    it('allow one start for a month in a country', async () => {
      expect(await insertOverride('OM', 1446, 10, '2025-04-01')).toMatchObject(
        uniqueViolation,
      );
    });
  });
});
