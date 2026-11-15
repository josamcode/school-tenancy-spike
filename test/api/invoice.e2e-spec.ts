import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types.js';
import {
  calendarInvoices,
  calendarSchools,
  schoolC,
  userA,
  userCalendar,
  userCalendarStaff,
  userCDE,
} from '../../db/seed.js';
import { AppModule } from '../../src/app.module.js';
import { tokenFor } from '../support/tokens.js';

const { dubai, riyadh, muscat, manama, kuwait, noCountry } = calendarSchools;
const unknownInvoice = 'ca100000-0000-4000-8000-00000000ffff';
const unknownSchool = 'ca100000-0000-4000-8000-0000000000ff';

// Schools that nothing writes. Finance is on for all of them.
describe('GET /schools/:schoolId/invoices/:invoiceId', () => {
  let app: INestApplication<App>;
  const tokens: Record<string, string> = {};

  const get = (
    school: { id: string } | string,
    invoice: { id: string } | string,
    user: { id: string } | null = userCalendar,
  ) => {
    const schoolId = typeof school === 'string' ? school : school.id;
    const invoiceId = typeof invoice === 'string' ? invoice : invoice.id;
    const call = request(app.getHttpServer()).get(
      `/schools/${schoolId}/invoices/${invoiceId}`,
    );
    return user ? call.set('Authorization', `Bearer ${tokens[user.id]}`) : call;
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    for (const user of [userCalendar, userCalendarStaff, userA, userCDE]) {
      tokens[user.id] = await tokenFor(user.id);
    }
  });

  afterAll(async () => {
    await app.close();
  });

  describe('the order of answers', () => {
    let membership403: unknown;

    beforeAll(async () => {
      const response = await request(app.getHttpServer())
        .get(`/schools/${dubai.id}/students`)
        .set('Authorization', `Bearer ${tokens[userA.id]}`)
        .expect(403);
      membership403 = response.body;
    });

    it('answers 401 without a token', async () => {
      await get(dubai, calendarInvoices.dubaiEid, null).expect(401);
    });

    it('answers 400 for a malformed school id', async () => {
      const response = await get('not-a-uuid', calendarInvoices.dubaiEid);
      expect(response.status).toBe(400);
      expect(response.body.message).toBe('Invalid school id');
    });

    it('answers the plain 403 to someone with no access to the school', async () => {
      const response = await get(dubai, calendarInvoices.dubaiEid, userA);
      expect(response.status).toBe(403);
      expect(response.body).toEqual(membership403);
    });

    it('answers the same 403 for a school that does not exist', async () => {
      const response = await get(unknownSchool, calendarInvoices.dubaiEid);
      expect(response.status).toBe(403);
      expect(response.body).toEqual(membership403);
    });

    it('answers the same 403 before it looks at a malformed invoice id', async () => {
      const response = await get(dubai, 'not-a-uuid', userA);
      expect(response.status).toBe(403);
      expect(response.body).toEqual(membership403);
    });

    it('answers 403 MODULE_DISABLED where finance is off', async () => {
      const response = await get(schoolC, calendarInvoices.dubaiEid, userCDE);
      expect(response.status).toBe(403);
      expect(response.body.code).toBe('MODULE_DISABLED');
    });

    it('answers 403 PERMISSION_DENIED to staff, who do not hold finance:read', async () => {
      const response = await get(
        dubai,
        calendarInvoices.dubaiEid,
        userCalendarStaff,
      );
      expect(response.status).toBe(403);
      expect(response.body.code).toBe('PERMISSION_DENIED');
    });

    it('answers 400 for a malformed invoice id', async () => {
      const response = await get(dubai, 'not-a-uuid');
      expect(response.status).toBe(400);
      expect(response.body.message).toBe('Invalid invoice id');
    });

    it('answers 404 for an invoice that does not exist', async () => {
      const response = await get(dubai, unknownInvoice);
      expect(response.status).toBe(404);
      expect(response.body.message).toBe('Invoice not found');
    });

    it('answers the same 404 for another school’s invoice', async () => {
      const missing = await get(dubai, unknownInvoice);
      const response = await get(dubai, calendarInvoices.riyadhEid);
      expect(response.status).toBe(404);
      expect(response.body).toEqual(missing.body);
    });
  });

  it('returns what the invoice shows', async () => {
    const response = await get(dubai, calendarInvoices.dubaiEid);
    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      id: calendarInvoices.dubaiEid.id,
      number: 1,
      school: { name: dubai.name, nameI18n: dubai.nameI18n },
      student: { fullName: 'Omar Al Farsi' },
      description: calendarInvoices.dubaiEid.description,
      amount: '12500.00',
      currency: 'AED',
      issueDate: {
        gregorian: '2026-03-20',
        hijri: { year: 1447, month: 10, day: 1 },
      },
      dueDate: {
        gregorian: '2026-04-17',
        hijri: { year: 1447, month: 10, day: 29 },
      },
    });
  });

  it('numbers a school’s invoices in the order they were issued', async () => {
    const response = await get(dubai, calendarInvoices.dubaiPlain);
    expect(response.body.number).toBe(2);
    expect(response.body.student).toEqual({ fullName: 'ليلى حسن' });
  });

  describe('the business date', () => {
    it('is the school’s own date for the same instant', async () => {
      expect(calendarInvoices.riyadhEid.issuedAt).toBe(
        calendarInvoices.dubaiEid.issuedAt,
      );
      const inDubai = await get(dubai, calendarInvoices.dubaiEid);
      const inRiyadh = await get(riyadh, calendarInvoices.riyadhEid);
      expect(inDubai.body.issueDate).toEqual({
        gregorian: '2026-03-20',
        hijri: { year: 1447, month: 10, day: 1 },
      });
      expect(inRiyadh.body.issueDate).toEqual({
        gregorian: '2026-03-19',
        hijri: { year: 1447, month: 9, day: 30 },
      });
    });
  });

  describe('the Hijri date', () => {
    it('follows the country’s override, and only in that country', async () => {
      expect(calendarInvoices.muscatEid.issuedAt).toBe(
        calendarInvoices.dubaiPlain.issuedAt,
      );
      const inMuscat = await get(muscat, calendarInvoices.muscatEid);
      const inDubai = await get(dubai, calendarInvoices.dubaiPlain);
      expect(inMuscat.body.issueDate).toEqual({
        gregorian: '2025-03-30',
        hijri: { year: 1446, month: 9, day: 30 },
      });
      expect(inDubai.body.issueDate).toEqual({
        gregorian: '2025-03-30',
        hijri: { year: 1446, month: 10, day: 1 },
      });
      expect(inMuscat.body.dueDate).toEqual({
        gregorian: '2025-04-28',
        hijri: { year: 1446, month: 10, day: 29 },
      });
      expect(inDubai.body.dueDate).toEqual({
        gregorian: '2025-04-28',
        hijri: { year: 1446, month: 10, day: 30 },
      });
    });

    it('follows an override that starts the month earlier than calculated', async () => {
      const response = await get(manama, calendarInvoices.manamaEid);
      expect(response.body.issueDate).toEqual({
        gregorian: '2026-03-19',
        hijri: { year: 1447, month: 10, day: 1 },
      });
      expect(response.body.dueDate).toEqual({
        gregorian: '2026-04-17',
        hijri: { year: 1447, month: 10, day: 30 },
      });
    });

    it('is calculated for a school with no country', async () => {
      const response = await get(noCountry, calendarInvoices.noCountry);
      expect(response.status).toBe(200);
      expect(response.body.issueDate).toEqual({
        gregorian: '2026-03-19',
        hijri: { year: 1447, month: 9, day: 30 },
      });
    });

    it('is not shown when the country’s override cannot be right', async () => {
      const response = await get(kuwait, calendarInvoices.kuwaitEid);
      expect(response.status).toBe(500);
      expect(JSON.stringify(response.body)).not.toContain('hijri');
    });
  });

  describe('the amount', () => {
    it.each([
      ['BHD', manama, calendarInvoices.manamaEid, '1234.500'],
      ['OMR', muscat, calendarInvoices.muscatEid, '450.250'],
      ['SAR', riyadh, calendarInvoices.riyadhEid, '9800.00'],
    ])('has the decimals of %s', async (currency, school, invoice, amount) => {
      const response = await get(school, invoice);
      expect(response.body.amount).toBe(amount);
      expect(response.body.currency).toBe(currency);
    });
  });

  it('leaves out what an invoice does not have', async () => {
    const response = await get(noCountry, calendarInvoices.noCountry);
    expect(response.body.school).toEqual({
      name: noCountry.name,
      nameI18n: null,
    });
    expect(response.body.description).toBeNull();
    expect(response.body.dueDate).toBeNull();
  });

  it('adds the number and the issue date to the list', async () => {
    const response = await request(app.getHttpServer())
      .get(`/schools/${dubai.id}/invoices`)
      .set('Authorization', `Bearer ${tokens[userCalendar.id]}`)
      .expect(200);
    const rows = (
      response.body as { id: string; number: number; issueDate: string }[]
    )
      .map(({ id, number, issueDate }) => ({ id, number, issueDate }))
      .sort((a, b) => a.number - b.number);
    expect(rows).toEqual([
      {
        id: calendarInvoices.dubaiEid.id,
        number: 1,
        issueDate: '2026-03-20',
      },
      {
        id: calendarInvoices.dubaiPlain.id,
        number: 2,
        issueDate: '2025-03-30',
      },
    ]);
  });
});
