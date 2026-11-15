import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types.js';
import {
  demoSchools,
  schoolA,
  schoolB,
  schoolC,
  schoolD,
  schoolH,
  userA,
  userBoth,
  userDemoGroupAdmin,
  userDemoPrincipal,
  userGroupAdmin,
  userStaffA,
  userStaffDGrantH,
} from '../../db/seed.js';
import { AppModule } from '../../src/app.module.js';
import { tokenFor } from '../support/tokens.js';

// Schools and access rows that nothing writes.
describe('GET /me/schools', () => {
  let app: INestApplication<App>;

  const get = async (user: { id: string } | null, path = '/me/schools') => {
    const call = request(app.getHttpServer()).get(path);
    return user
      ? call.set('Authorization', `Bearer ${await tokenFor(user.id)}`)
      : call;
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('answers 401 without a token', async () => {
    expect((await get(null)).status).toBe(401);
  });

  it('lists both schools of a member of two, by name', async () => {
    const response = await get(userBoth);
    expect(response.status).toBe(200);
    expect(response.body).toEqual([
      {
        id: schoolB.id,
        name: schoolB.name,
        nameI18n: null,
        role: 'school_admin',
        grants: [],
      },
      {
        id: schoolA.id,
        name: schoolA.name,
        nameI18n: null,
        role: 'school_admin',
        grants: [],
      },
    ]);
  });

  it('gives the role the user has in each school', async () => {
    const response = await get(userStaffA);
    expect(response.status).toBe(200);
    expect(
      response.body.map((school: { id: string; role: string }) => [
        school.id,
        school.role,
      ]),
    ).toEqual([
      [schoolA.id, 'staff'],
      [schoolC.id, 'school_admin'],
    ]);
  });

  it('lists a school the user holds only a grant in, with no role', async () => {
    const response = await get(userGroupAdmin);
    expect(response.status).toBe(200);
    // School A is in the same group. The group gives nothing.
    expect(response.body).toEqual([
      {
        id: schoolB.id,
        name: schoolB.name,
        nameI18n: null,
        role: null,
        grants: ['students:read'],
      },
    ]);
  });

  it('lists a membership in one school and a grant in another', async () => {
    const response = await get(userStaffDGrantH);
    expect(response.status).toBe(200);
    expect(response.body).toEqual([
      {
        id: schoolH.id,
        name: schoolH.name,
        nameI18n: null,
        role: null,
        grants: ['students:create'],
      },
      {
        id: schoolD.id,
        name: schoolD.name,
        nameI18n: null,
        role: 'staff',
        grants: [],
      },
    ]);
  });

  it('gives each school its name in both languages where it has one', async () => {
    const response = await get(userDemoPrincipal);
    expect(response.status).toBe(200);
    const { yasmin, rayhan, ghadeer, murooj } = demoSchools;
    expect(response.body).toEqual(
      [ghadeer, murooj, rayhan, yasmin].map((school) => ({
        id: school.id,
        name: school.name,
        nameI18n: school.nameI18n,
        role: 'school_admin',
        grants: [],
      })),
    );
  });

  it('leaves out the school of a group the user administers but has no grant in', async () => {
    const response = await get(userDemoGroupAdmin);
    expect(response.status).toBe(200);
    expect(response.body).toEqual([
      {
        id: demoSchools.yasmin.id,
        name: demoSchools.yasmin.name,
        nameI18n: demoSchools.yasmin.nameI18n,
        role: null,
        grants: ['finance:read'],
      },
    ]);
  });

  it('answers an empty list to a user with no school', async () => {
    const response = await get({ id: randomUUID() });
    expect(response.status).toBe(200);
    expect(response.body).toEqual([]);
  });

  it('takes no school from the request', async () => {
    const plain = await get(userA);
    expect(plain.status).toBe(200);
    expect(plain.body.map((school: { id: string }) => school.id)).toEqual([
      schoolA.id,
    ]);

    const token = await tokenFor(userA.id);
    const named = await request(app.getHttpServer())
      .get(`/me/schools?schoolId=${schoolB.id}&userId=${userBoth.id}`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-School-Id', schoolB.id)
      .set('X-User-Id', userBoth.id);
    expect(named.status).toBe(200);
    expect(named.body).toEqual(plain.body);
  });
});
