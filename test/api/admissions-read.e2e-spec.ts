import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import pg from 'pg';
import request from 'supertest';
import { App } from 'supertest/types.js';
import {
  demoPending,
  demoSchools,
  userDemoPrincipal,
  userDemoSindyan,
  userDemoTeacher,
} from '../../db/seed.js';
import { AppModule } from '../../src/app.module.js';
import { PERMISSIONS } from '../../src/entitlements/permissions.js';
import { ownerPool } from '../support/db.js';
import { tokenFor } from '../support/tokens.js';

const { yasmin, rayhan, ghadeer, murooj } = demoSchools;
const unknownSchool = 'de700000-0000-4000-8000-0000000000ff';
const unknownApplication = 'de700000-0000-4000-8000-004a0000ffff';

// Demo schools, which no test in this run writes: every application in them
// is still pending. Admissions is on in Yasmin, Ghadeer and Murooj.
describe('reading admission applications', () => {
  let app: INestApplication<App>;
  const tokens: Record<string, string> = {};
  let membership403: unknown;

  const get = (
    path: string,
    user: { id: string } | null = userDemoPrincipal,
  ) => {
    const call = request(app.getHttpServer()).get(path);
    return user ? call.set('Authorization', `Bearer ${tokens[user.id]}`) : call;
  };
  const list = (school: { id: string } | string) =>
    `/schools/${typeof school === 'string' ? school : school.id}/admissions/applications`;
  const event = (
    school: { id: string } | string,
    application: { id: string } | string,
  ) =>
    `${list(school)}/${typeof application === 'string' ? application : application.id}/event`;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    for (const user of [userDemoPrincipal, userDemoTeacher, userDemoSindyan]) {
      tokens[user.id] = await tokenFor(user.id);
    }
    const response = await get(
      `/schools/${ghadeer.id}/students`,
      userDemoSindyan,
    ).expect(403);
    membership403 = response.body;
  });

  afterAll(async () => {
    await app.close();
  });

  describe('the permission', () => {
    let owner: pg.Pool;

    beforeAll(() => {
      owner = ownerPool();
    });

    afterAll(async () => {
      await owner.end();
    });

    it('is admissions:read, in the code and in the permissions table', async () => {
      expect(PERMISSIONS).toContain('admissions:read');
      const { rows } = await owner.query(
        "select key from permissions where key = 'admissions:read'",
      );
      expect(rows).toEqual([{ key: 'admissions:read' }]);
    });

    it('is held by a school admin and not by staff', async () => {
      const { rows } = await owner.query(
        "select role from role_permissions where permission = 'admissions:read' order by role",
      );
      expect(rows).toEqual([{ role: 'school_admin' }]);
    });
  });

  for (const [name, path] of [
    ['the list', (school: { id: string } | string) => list(school)],
    [
      'the event of an application',
      (school: { id: string } | string) =>
        event(school, demoPending.ghadeer[0]),
    ],
  ] as const) {
    describe(`the order of answers for ${name}`, () => {
      it('answers 401 without a token', async () => {
        await get(path(ghadeer), null).expect(401);
      });

      it('answers 400 for a malformed school id', async () => {
        const response = await get(path('not-a-uuid'));
        expect(response.status).toBe(400);
        expect(response.body.message).toBe('Invalid school id');
      });

      it('answers the plain 403 to someone with no access to the school', async () => {
        const response = await get(path(ghadeer), userDemoSindyan);
        expect(response.status).toBe(403);
        expect(response.body).toEqual(membership403);
      });

      it('answers the same 403 for a school that does not exist', async () => {
        const response = await get(path(unknownSchool));
        expect(response.status).toBe(403);
        expect(response.body).toEqual(membership403);
      });

      it('answers 403 MODULE_DISABLED where admissions is off', async () => {
        const response = await get(path(rayhan));
        expect(response.status).toBe(403);
        expect(response.body.code).toBe('MODULE_DISABLED');
      });

      it('answers 403 PERMISSION_DENIED to staff, who do not hold admissions:read', async () => {
        const response = await get(path(yasmin), userDemoTeacher);
        expect(response.status).toBe(403);
        expect(response.body.code).toBe('PERMISSION_DENIED');
      });
    });
  }

  describe('the list', () => {
    it('gives the school’s applications in a fixed order', async () => {
      const response = await get(list(ghadeer));
      expect(response.status).toBe(200);
      expect(response.body).toEqual(
        demoPending.ghadeer.map((application) => ({
          id: application.id,
          applicantName: application.applicantName,
          status: 'pending',
          studentId: null,
          acceptedAt: null,
        })),
      );
      expect(response.body).toHaveLength(6);
    });

    it('gives another school its own applications, which have the same names', async () => {
      const response = await get(list(murooj));
      expect(response.status).toBe(200);
      expect(
        response.body.map((application: { id: string }) => application.id),
      ).toEqual(demoPending.murooj.map((application) => application.id));
    });

    it('is empty where the school has none', async () => {
      const response = await get(list(yasmin));
      expect(response.status).toBe(200);
      expect(response.body).toEqual([]);
    });
  });

  describe('the event of an application that is not there to follow', () => {
    it('answers 400 for a malformed application id', async () => {
      const response = await get(event(ghadeer, 'not-a-uuid'));
      expect(response.status).toBe(400);
      expect(response.body.message).toBe('Invalid application id');
    });

    it('answers 404 for an application that does not exist', async () => {
      const response = await get(event(ghadeer, unknownApplication));
      expect(response.status).toBe(404);
      expect(response.body.message).toBe('Application not found');
    });

    it('answers the same 404 for an application of another school', async () => {
      // It is there, in its own school.
      const own = await get(list(murooj));
      expect(
        own.body.map((application: { id: string }) => application.id),
      ).toContain(demoPending.murooj[0].id);

      const response = await get(event(ghadeer, demoPending.murooj[0]));
      expect(response.status).toBe(404);
      expect(response.body.message).toBe('Application not found');
    });

    it('answers 404 for an application that is still pending, which has no event', async () => {
      const response = await get(event(ghadeer, demoPending.ghadeer[0]));
      expect(response.status).toBe(404);
      expect(response.body.message).toBe('No event for this application');
    });
  });
});
