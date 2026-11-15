import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types.js';
import {
  invoicesA,
  invoicesB,
  schoolA,
  schoolB,
  schoolC,
  schoolD,
  schoolE,
  studentsC,
  userA,
  userCDE,
} from '../../db/seed.js';
import { AppModule } from '../../src/app.module.js';
import { asOwnerOf } from '../support/db.js';
import { tokenFor } from '../support/tokens.js';

const moduleDisabled = {
  statusCode: 403,
  code: 'MODULE_DISABLED',
  message: 'Module disabled',
};
const unknownSchool = 'dddddddd-0000-4000-8000-000000000002';

describe('module entitlements', () => {
  let app: INestApplication<App>;
  let tokenA: string;
  let tokenCDE: string;

  const http = () => request(app.getHttpServer());
  const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    tokenA = await tokenFor(userA.id);
    tokenCDE = await tokenFor(userCDE.id);
  });

  afterAll(async () => {
    await app.close();
  });

  describe('a school with finance on', () => {
    it('lets a member read its own invoices and nobody else’s', async () => {
      const response = await http()
        .get(`/schools/${schoolA.id}/invoices`)
        .set(bearer(tokenA))
        .expect(200);
      const ids = response.body.map((row: { id: string }) => row.id);
      expect(ids).toEqual(expect.arrayContaining(invoicesA.map((i) => i.id)));
      expect(
        response.body.every(
          (row: { tenantId: string }) => row.tenantId === schoolA.id,
        ),
      ).toBe(true);
      for (const invoice of invoicesB) expect(ids).not.toContain(invoice.id);
    });
  });

  describe('a school with finance switched off', () => {
    it('answers a member with 403 MODULE_DISABLED on invoices', async () => {
      const response = await http()
        .get(`/schools/${schoolC.id}/invoices`)
        .set(bearer(tokenCDE))
        .expect(403);
      expect(response.body).toEqual(moduleDisabled);
    });

    it('still lets the same member use students', async () => {
      const response = await http()
        .get(`/schools/${schoolC.id}/students`)
        .set(bearer(tokenCDE))
        .expect(200);
      const ids = response.body.map((row: { id: string }) => row.id);
      expect(ids).toEqual(expect.arrayContaining(studentsC.map((s) => s.id)));
    });
  });

  describe('a school with no row for finance', () => {
    it('answers a member with 403 MODULE_DISABLED on invoices', async () => {
      const response = await http()
        .get(`/schools/${schoolD.id}/invoices`)
        .set(bearer(tokenCDE))
        .expect(403);
      expect(response.body).toEqual(moduleDisabled);
    });

    it('still lets the same member use students', async () => {
      await http()
        .get(`/schools/${schoolD.id}/students`)
        .set(bearer(tokenCDE))
        .expect(200);
    });
  });

  describe('a user who is not a member', () => {
    let membership403: unknown;

    beforeAll(async () => {
      const response = await http()
        .get(`/schools/${schoolB.id}/students`)
        .set(bearer(tokenA))
        .expect(403);
      membership403 = response.body;
    });

    it('gets the plain membership 403 on invoices, even when finance is off for that school', async () => {
      const response = await http()
        .get(`/schools/${schoolC.id}/invoices`)
        .set(bearer(tokenA))
        .expect(403);
      expect(response.body).toEqual(membership403);
      expect(response.body).not.toHaveProperty('code');
    });

    it('gets the same 403 on invoices of a school with no finance row', async () => {
      const response = await http()
        .get(`/schools/${schoolD.id}/invoices`)
        .set(bearer(tokenA))
        .expect(403);
      expect(response.body).toEqual(membership403);
    });

    it('gets the same 403 on invoices of a school with finance on', async () => {
      const response = await http()
        .get(`/schools/${schoolB.id}/invoices`)
        .set(bearer(tokenA))
        .expect(403);
      expect(response.body).toEqual(membership403);
    });

    it('gets the same 403 on invoices of a school that does not exist', async () => {
      const response = await http()
        .get(`/schools/${unknownSchool}/invoices`)
        .set(bearer(tokenA))
        .expect(403);
      expect(response.body).toEqual(membership403);
    });
  });

  describe('switching finance for a school', () => {
    const invoicesOfE = () =>
      http().get(`/schools/${schoolE.id}/invoices`).set(bearer(tokenCDE));
    const setFinance = (enabled: boolean) =>
      asOwnerOf(schoolE.id, async (client) => {
        await client.query(
          `insert into tenant_modules (module, enabled) values ($1, $2)
           on conflict (tenant_id, module) do update set enabled = excluded.enabled`,
          ['finance', enabled],
        );
      });

    afterAll(async () => {
      await asOwnerOf(schoolE.id, async (client) => {
        await client.query('delete from tenant_modules where module = $1', [
          'finance',
        ]);
      });
    });

    it('takes effect on the next request, without a restart, in both directions', async () => {
      const before = await invoicesOfE();
      expect(before.status).toBe(403);
      expect(before.body).toEqual(moduleDisabled);

      await setFinance(true);
      const enabled = await invoicesOfE();
      expect(enabled.status).toBe(200);
      expect(enabled.body).toEqual([]);

      await setFinance(false);
      const disabled = await invoicesOfE();
      expect(disabled.status).toBe(403);
      expect(disabled.body).toEqual(moduleDisabled);

      await setFinance(true);
      const enabledAgain = await invoicesOfE();
      expect(enabledAgain.status).toBe(200);
    });
  });
});
