import { Controller, Get, INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { sql } from 'drizzle-orm';
import request from 'supertest';
import { App } from 'supertest/types.js';
import {
  schoolA,
  schoolB,
  studentsA,
  studentsB,
  userA,
} from '../../db/seed.js';
import { AppModule } from '../../src/app.module.js';
import { DbModule } from '../../src/db/db.module.js';
import { TenantDb } from '../../src/db/tenant-db.js';
import { registeredRoutes } from '../support/routes.js';
import { tokenFor } from '../support/tokens.js';

const publicRoutes = ['GET /health'];

describe('every registered route', () => {
  let app: INestApplication<App>;

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

  it('is found by reading the router, so the checks below are not empty', () => {
    const names = registeredRoutes(app).map((r) => `${r.method} ${r.path}`);
    expect(names).toEqual(
      expect.arrayContaining([
        'GET /health',
        'GET /schools/:schoolId/students',
        'POST /schools/:schoolId/students',
      ]),
    );
  });

  it('returns 401 without a token, except exactly GET /health', async () => {
    const open: string[] = [];
    for (const route of registeredRoutes(app)) {
      const url = route.path.replace(/:[A-Za-z0-9_]+/g, schoolA.id);
      const response = await request(app.getHttpServer())[
        route.method.toLowerCase() as 'get'
      ](url);
      if (response.status !== 401) open.push(`${route.method} ${route.path}`);
    }
    expect(open).toEqual(publicRoutes);
  });
});

// A controller written the way a careless one would be: no guard, no interceptor.
@Controller()
class UndecoratedController {
  constructor(private readonly tenantDb: TenantDb) {}

  @Get('undecorated')
  outsideAnySchool() {
    return this.tenantDb.db.execute(sql`select 1`);
  }

  @Get('schools/:schoolId/undecorated')
  async insideASchool() {
    const result = await this.tenantDb.db.execute<{ id: string }>(
      sql`select id from students`,
    );
    return result.rows.map((row) => row.id);
  }
}

describe('a controller that declares no guard and no interceptor', () => {
  let app: INestApplication<App>;
  let tokenA: string;

  const http = () => request(app.getHttpServer());
  const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule, DbModule],
      controllers: [UndecoratedController],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    tokenA = await tokenFor(userA.id);
  });

  afterAll(async () => {
    await app.close();
  });

  it('still returns 401 without a token', async () => {
    await http().get('/undecorated').expect(401);
    await http().get(`/schools/${schoolA.id}/undecorated`).expect(401);
  });

  it('gets the tenant transaction when the path has a school id', async () => {
    const response = await http()
      .get(`/schools/${schoolA.id}/undecorated`)
      .set(bearer(tokenA))
      .expect(200);
    expect(response.body).toEqual(
      expect.arrayContaining(studentsA.map((s) => s.id)),
    );
    for (const student of studentsB) {
      expect(response.body).not.toContain(student.id);
    }
  });

  it('still returns 403 for a school the user is not in', async () => {
    await http()
      .get(`/schools/${schoolB.id}/undecorated`)
      .set(bearer(tokenA))
      .expect(403);
  });

  it('still returns 400 for a malformed school id', async () => {
    await http()
      .get('/schools/not-a-uuid/undecorated')
      .set(bearer(tokenA))
      .expect(400);
  });

  it('cannot reach the database when the path has no school id', async () => {
    await http().get('/undecorated').set(bearer(tokenA)).expect(500);
  });
});
