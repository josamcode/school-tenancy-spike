import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types.js';
import {
  demoSchools,
  schoolOrder,
  studentsOrder,
  userDemoPrincipal,
  userOrder,
} from '../../db/seed.js';
import { AppModule } from '../../src/app.module.js';
import { tokenFor } from '../support/tokens.js';

interface StudentRow {
  id: string;
  fullName: string;
}

// Schools that nothing writes, so the whole list can be compared.
describe('the order of GET /schools/:schoolId/students', () => {
  let app: INestApplication<App>;

  const list = async (school: { id: string }, user: { id: string }) => {
    const response = await request(app.getHttpServer())
      .get(`/schools/${school.id}/students`)
      .set('Authorization', `Bearer ${await tokenFor(user.id)}`)
      .expect(200);
    return (response.body as StudentRow[]).map((row) => [row.fullName, row.id]);
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

  it('is by full name, and by id where two students have the same name', async () => {
    const [omar, laylaStoredFirst, layla, ahmad] = studentsOrder;
    // The fixture is stored in another order, so the answer is not the
    // order the rows went in.
    expect(laylaStoredFirst.fullName).toBe(layla.fullName);
    expect(laylaStoredFirst.id > layla.id).toBe(true);

    expect(await list(schoolOrder, userOrder)).toEqual(
      [ahmad, layla, laylaStoredFirst, omar].map((student) => [
        student.fullName,
        student.id,
      ]),
    );
  });

  it('is the same on every request', async () => {
    const first = await list(schoolOrder, userOrder);
    for (let again = 0; again < 5; again++) {
      expect(await list(schoolOrder, userOrder)).toEqual(first);
    }
  });

  it('puts Arabic names in order too', async () => {
    const [salem, tala] = demoSchools.yasmin.students;
    expect(await list(demoSchools.yasmin, userDemoPrincipal)).toEqual([
      [tala.fullName, tala.id],
      [salem.fullName, salem.id],
    ]);
  });
});
