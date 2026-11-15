import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types.js';
import {
  demoSchools,
  userDemoGroupAdmin,
  userDemoPrincipal,
  userDemoSindyan,
  userDemoTeacher,
} from '../../db/seed.js';
import { AppModule } from '../../src/app.module.js';
import { registeredRoutes } from '../support/routes.js';
import { tokenFor } from '../support/tokens.js';

const { yasmin, rayhan, ghadeer } = demoSchools;
const [salem, tala] = yasmin.students;
const unknownSchool = 'de700000-0000-4000-8000-0000000000ff';

// Demo schools, which no test in this run writes. Yasmin holds the netting
// scenario of the ledger tests.
describe('GET /schools/:schoolId/ledger', () => {
  let app: INestApplication<App>;
  const tokens: Record<string, string> = {};

  const get = (
    school: { id: string } | string,
    user: { id: string } | null = userDemoPrincipal,
  ) => {
    const schoolId = typeof school === 'string' ? school : school.id;
    const call = request(app.getHttpServer()).get(
      `/schools/${schoolId}/ledger`,
    );
    return user ? call.set('Authorization', `Bearer ${tokens[user.id]}`) : call;
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    for (const user of [
      userDemoPrincipal,
      userDemoTeacher,
      userDemoGroupAdmin,
      userDemoSindyan,
    ]) {
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
        .get(`/schools/${yasmin.id}/students`)
        .set('Authorization', `Bearer ${tokens[userDemoSindyan.id]}`)
        .expect(403);
      membership403 = response.body;
    });

    it('answers 401 without a token', async () => {
      await get(yasmin, null).expect(401);
    });

    it('answers 400 for a malformed school id', async () => {
      const response = await get('not-a-uuid');
      expect(response.status).toBe(400);
      expect(response.body.message).toBe('Invalid school id');
    });

    it('answers the plain 403 to someone with no access to the school', async () => {
      const response = await get(yasmin, userDemoSindyan);
      expect(response.status).toBe(403);
      expect(response.body).toEqual(membership403);
    });

    it('answers the same 403 for a school that does not exist', async () => {
      const response = await get(unknownSchool);
      expect(response.status).toBe(403);
      expect(response.body).toEqual(membership403);
    });

    it('answers 403 MODULE_DISABLED where finance is off', async () => {
      const response = await get(rayhan);
      expect(response.status).toBe(403);
      expect(response.body.code).toBe('MODULE_DISABLED');
    });

    it('answers 403 PERMISSION_DENIED to staff, who do not hold finance:read', async () => {
      const response = await get(yasmin, userDemoTeacher);
      expect(response.status).toBe(403);
      expect(response.body.code).toBe('PERMISSION_DENIED');
    });

    it('answers 200 to a school admin, and to someone who holds finance:read through a grant', async () => {
      const admin = await get(yasmin);
      expect(admin.status).toBe(200);
      const granted = await get(yasmin, userDemoGroupAdmin);
      expect(granted.status).toBe(200);
      expect(granted.body).toEqual(admin.body);
    });
  });

  describe('the books of the netting scenario', () => {
    let body: Record<string, unknown>;

    beforeAll(async () => {
      const response = await get(yasmin);
      expect(response.status).toBe(200);
      body = response.body;
    });

    it('sums to zero in every currency, at that currency’s decimals', () => {
      expect(body.baseCurrency).toBe('AED');
      expect(body.currencyTotals).toEqual([
        { currency: 'AED', total: '0.00' },
        { currency: 'BHD', total: '0.000' },
        { currency: 'SAR', total: '0.00' },
      ]);
    });

    it('gives each student’s balance with their name', () => {
      expect(body.studentBalances).toEqual([
        {
          studentId: salem.id,
          fullName: salem.fullName,
          currency: 'AED',
          balance: '0.00',
        },
        {
          studentId: tala.id,
          fullName: tala.fullName,
          currency: 'AED',
          balance: '206.00',
        },
      ]);
    });

    it('gives each FX position: what is held and what it stands at in the base currency', () => {
      expect(body.fxPositions).toEqual([
        {
          currency: 'BHD',
          held: '0.000',
          baseCurrency: 'AED',
          bookValue: '0.00',
        },
        {
          currency: 'SAR',
          held: '300.00',
          baseCurrency: 'AED',
          bookValue: '293.70',
        },
      ]);
    });

    it('gives the FX gain: 5.00 from closing BHD less 0.30 from revaluing SAR', () => {
      expect(body.fxGainLoss).toEqual([{ currency: 'AED', gain: '4.70' }]);
    });

    it('shows December 2025 locked and January 2026 open', () => {
      expect(body.periods).toEqual([
        {
          year: 'FY2025',
          startDate: '2025-12-01',
          endDate: '2025-12-31',
          status: 'locked',
        },
        {
          year: 'FY2026',
          startDate: '2026-01-01',
          endDate: '2026-01-31',
          status: 'open',
        },
      ]);
    });

    it('has nothing else in it', () => {
      expect(Object.keys(body).sort()).toEqual([
        'baseCurrency',
        'currencyTotals',
        'fxGainLoss',
        'fxPositions',
        'periods',
        'studentBalances',
      ]);
    });
  });

  it('shows another school of the same user its own books and none of these', async () => {
    const response = await get(ghadeer);
    expect(response.status).toBe(200);
    expect(response.body.currencyTotals).toEqual([]);
    expect(response.body.studentBalances).toEqual([]);
    expect(response.body.fxPositions).toEqual([]);
    expect(response.body.fxGainLoss).toEqual([]);
    expect(
      response.body.periods.map((period: { year: string }) => period.year),
    ).toEqual(['FY2026', 'FY2027', 'FY2028', 'FY2029', 'FY2030']);
  });

  it('is the only ledger route, and no route writes the ledger', () => {
    const routes = registeredRoutes(app).map(
      (route) => `${route.method} ${route.path}`,
    );
    expect(routes.filter((route) => /ledger/i.test(route))).toEqual([
      'GET /schools/:schoolId/ledger',
    ]);
    // Every route that is not a read. Neither of them posts an entry.
    expect(routes.filter((route) => !route.startsWith('GET ')).sort()).toEqual([
      'POST /schools/:schoolId/admissions/applications/:applicationId/accept',
      'POST /schools/:schoolId/students',
    ]);
  });
});
