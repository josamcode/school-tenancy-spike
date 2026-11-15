import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types.js';
import {
  schoolA,
  schoolB,
  studentsA,
  studentsB,
  userA,
  userB,
} from '../../db/seed.js';
import { AppModule } from '../../src/app.module.js';
import {
  expiredToken,
  tokenFor,
  tokenSignedWithAnotherKey,
  tokenWithoutExpiry,
  tokenWithoutSubject,
  unsignedToken,
} from '../support/tokens.js';

interface StudentRow {
  id: string;
  tenantId: string;
  fullName: string;
}

const unknownSchool = 'dddddddd-0000-4000-8000-000000000001';

describe('/schools/:schoolId/students', () => {
  let app: INestApplication<App>;
  let tokenA: string;
  let tokenB: string;

  const http = () => request(app.getHttpServer());
  const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.listen(0);
    tokenA = await tokenFor(userA.id);
    tokenB = await tokenFor(userB.id);
  });

  afterAll(async () => {
    await app.close();
  });

  function expectOnlySchool(
    rows: StudentRow[],
    own: { id: string; students: { id: string }[] },
    other: { students: { id: string }[] },
  ) {
    const ids = rows.map((r) => r.id);
    expect(ids).toEqual(expect.arrayContaining(own.students.map((s) => s.id)));
    expect(rows.every((r) => r.tenantId === own.id)).toBe(true);
    for (const student of other.students) expect(ids).not.toContain(student.id);
  }
  const a = { id: schoolA.id, students: studentsA };
  const b = { id: schoolB.id, students: studentsB };

  describe('authentication', () => {
    const url = `/schools/${schoolA.id}/students`;

    it('returns 401 with no token', async () => {
      await http().get(url).expect(401);
    });

    it('returns 401 for a value that is not a token', async () => {
      await http().get(url).set(bearer('not.a.token')).expect(401);
    });

    it('returns 401 for a token without the Bearer scheme', async () => {
      await http().get(url).set({ Authorization: tokenA }).expect(401);
    });

    it('returns 401 for a token signed with another key', async () => {
      const token = await tokenSignedWithAnotherKey(userA.id);
      await http().get(url).set(bearer(token)).expect(401);
    });

    it('returns 401 for an unsigned token', async () => {
      await http()
        .get(url)
        .set(bearer(unsignedToken(userA.id)))
        .expect(401);
    });

    it('returns 401 for an expired token', async () => {
      const token = await expiredToken(userA.id);
      await http().get(url).set(bearer(token)).expect(401);
    });

    it('returns 401 for a correctly signed token with no expiry', async () => {
      const token = await tokenWithoutExpiry(userA.id);
      await http().get(url).set(bearer(token)).expect(401);
    });

    it('returns 401 for a correctly signed token whose subject is not a uuid', async () => {
      const token = await tokenFor('not-a-uuid');
      await http().get(url).set(bearer(token)).expect(401);
    });

    it('returns 401 for a correctly signed token with no subject', async () => {
      const token = await tokenWithoutSubject();
      await http().get(url).set(bearer(token)).expect(401);
    });
  });

  describe('membership', () => {
    it('lets a user of school A read school A', async () => {
      const response = await http()
        .get(`/schools/${schoolA.id}/students`)
        .set(bearer(tokenA))
        .expect(200);
      expectOnlySchool(response.body, a, b);
    });

    it('returns 403 to a user of school A on school B', async () => {
      await http()
        .get(`/schools/${schoolB.id}/students`)
        .set(bearer(tokenA))
        .expect(403);
    });

    it('returns 403 to a user of school A creating a student in school B', async () => {
      await http()
        .post(`/schools/${schoolB.id}/students`)
        .set(bearer(tokenA))
        .send({ fullName: 'Not Allowed' })
        .expect(403);
    });

    it('answers a school that does not exist exactly like a school the user is not in', async () => {
      const notMember = await http()
        .get(`/schools/${schoolB.id}/students`)
        .set(bearer(tokenA));
      const unknown = await http()
        .get(`/schools/${unknownSchool}/students`)
        .set(bearer(tokenA));

      expect(unknown.status).toBe(403);
      expect(unknown.status).toBe(notMember.status);
      expect(unknown.body).toEqual(notMember.body);
    });

    it.each(['not-a-uuid', '123', `${schoolA.id}x`, "' or 1=1 --"])(
      'returns 400 for the malformed school id %s',
      async (schoolId) => {
        await http()
          .get(`/schools/${encodeURIComponent(schoolId)}/students`)
          .set(bearer(tokenA))
          .expect(400);
      },
    );
  });

  describe('a tenant id supplied by the client', () => {
    it('has no effect in a header or the query string', async () => {
      const response = await http()
        .get(`/schools/${schoolA.id}/students`)
        .query({
          tenantId: schoolB.id,
          tenant_id: schoolB.id,
          schoolId: schoolB.id,
        })
        .set(bearer(tokenA))
        .set('X-Tenant-Id', schoolB.id)
        .set('X-School-Id', schoolB.id)
        .expect(200);
      expectOnlySchool(response.body, a, b);
    });

    it('has no effect in the body', async () => {
      const fullName = `Body Check ${Date.now()}`;
      const created = await http()
        .post(`/schools/${schoolA.id}/students`)
        .query({ tenantId: schoolB.id })
        .set(bearer(tokenA))
        .set('X-Tenant-Id', schoolB.id)
        .send({
          fullName,
          tenantId: schoolB.id,
          tenant_id: schoolB.id,
          schoolId: schoolB.id,
        })
        .expect(201);
      expect(created.body).toMatchObject({ tenantId: schoolA.id, fullName });

      const inA = await http()
        .get(`/schools/${schoolA.id}/students`)
        .set(bearer(tokenA))
        .expect(200);
      const inB = await http()
        .get(`/schools/${schoolB.id}/students`)
        .set(bearer(tokenB))
        .expect(200);
      const names = (rows: StudentRow[]) => rows.map((r) => r.fullName);
      expect(names(inA.body)).toContain(fullName);
      expect(names(inB.body)).not.toContain(fullName);
    });
  });

  describe('creating a student', () => {
    it('returns 400 when the name is missing', async () => {
      await http()
        .post(`/schools/${schoolA.id}/students`)
        .set(bearer(tokenA))
        .send({})
        .expect(400);
    });
  });

  describe('concurrency', () => {
    it('50 interleaved requests for A and B each see only their own rows', async () => {
      const calls = Array.from({ length: 50 }, (_, i) => {
        const forA = i % 2 === 0;
        return http()
          .get(`/schools/${forA ? schoolA.id : schoolB.id}/students`)
          .set(bearer(forA ? tokenA : tokenB))
          .then((response) => ({ forA, response }));
      });
      const results = await Promise.all(calls);

      expect(results).toHaveLength(50);
      for (const { forA, response } of results) {
        expect(response.status).toBe(200);
        if (forA) expectOnlySchool(response.body, a, b);
        else expectOnlySchool(response.body, b, a);
      }
    });
  });
});
