import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import pg from 'pg';
import request from 'supertest';
import { App } from 'supertest/types.js';
import {
  applications,
  eventSchools,
  schoolD,
  userA,
  userCDE,
  userEvents,
  userEventsStaff,
} from '../../db/seed.js';
import { AppModule } from '../../src/app.module.js';
import { inScope, runtimePool, sleep } from '../support/db.js';
import { tokenFor } from '../support/tokens.js';

const school = eventSchools.accept;

interface ApplicationRow {
  status: string;
  student_id: string | null;
  accepted_by: string | null;
  accepted_at: Date | null;
}

interface EventRow {
  id: string;
  type: string;
  payload: { applicationId: string; studentId: string; acceptedAt: string };
  actor_user_id: string;
  dispatched_at: Date | null;
}

// One school with admissions on, written only by this file. Each test accepts
// an application of its own.
describe('accepting a student', () => {
  let app: INestApplication<App>;
  let pool: pg.Pool;
  const tokens: Record<string, string> = {};

  const accept = (
    application: { id: string },
    user: { id: string } | null = userEvents,
    schoolId = school.id,
  ) => {
    const call = request(app.getHttpServer()).post(
      `/schools/${schoolId}/admissions/applications/${application.id}/accept`,
    );
    return user ? call.set('Authorization', `Bearer ${tokens[user.id]}`) : call;
  };

  const inSchool = <T>(fn: (client: pg.PoolClient) => Promise<T>) =>
    inScope(pool, { tenantId: school.id }, fn);

  const applicationRow = (application: { id: string }) =>
    inSchool(async (client) => {
      const { rows } = await client.query<ApplicationRow>(
        `select status, student_id, accepted_by, accepted_at
           from admission_applications where id = $1`,
        [application.id],
      );
      return rows[0];
    });

  const eventsFor = (application: { id: string }) =>
    inSchool(async (client) => {
      const { rows } = await client.query<EventRow>(
        `select id, type, payload, actor_user_id, dispatched_at
           from outbox_events where payload->>'applicationId' = $1`,
        [application.id],
      );
      return rows;
    });

  const studentsNamed = (name: string) =>
    inSchool(async (client) => {
      const { rows } = await client.query<{ id: string }>(
        'select id from students where full_name = $1',
        [name],
      );
      return rows.map((row) => row.id);
    });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    // Listening before the tests start, so two requests can be sent at once.
    await app.listen(0, '127.0.0.1');
    pool = runtimePool();
    for (const user of [userEvents, userEventsStaff, userA, userCDE]) {
      tokens[user.id] = await tokenFor(user.id);
    }
  });

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  describe('who may accept', () => {
    it('answers 401 without a token', async () => {
      await accept(applications.denied, null).expect(401);
    });

    it('answers the plain 403 to a user with no access to the school', async () => {
      const response = await accept(applications.denied, userA).expect(403);
      expect(response.body.code).toBeUndefined();
    });

    it('answers MODULE_DISABLED in a school where admissions is off', async () => {
      const response = await accept(
        applications.denied,
        userCDE,
        schoolD.id,
      ).expect(403);
      expect(response.body).toEqual({
        statusCode: 403,
        code: 'MODULE_DISABLED',
        message: 'Module disabled',
      });
    });

    it('answers PERMISSION_DENIED to staff, who do not hold admissions:accept', async () => {
      const response = await accept(
        applications.denied,
        userEventsStaff,
      ).expect(403);
      expect(response.body).toEqual({
        statusCode: 403,
        code: 'PERMISSION_DENIED',
        message: 'Permission denied',
      });
    });

    it('answers 400 to an application id that is not a uuid', async () => {
      await accept({ id: 'not-a-uuid' }).expect(400);
    });

    it('answers 404 to an application that is not in this school', async () => {
      const response = await accept(applications.rolledBack).expect(404);
      expect(response.body.message).toBe('Application not found');
    });

    it('left the refused application pending, with no event', async () => {
      expect(await applicationRow(applications.denied)).toMatchObject({
        status: 'pending',
        student_id: null,
      });
      expect(await eventsFor(applications.denied)).toEqual([]);
    });
  });

  describe('an acceptance', () => {
    let body: { applicationId: string; studentId: string };

    beforeAll(async () => {
      const response = await accept(applications.accepted).expect(201);
      body = response.body;
    });

    it('answers with the application and the new student', () => {
      expect(body.applicationId).toBe(applications.accepted.id);
      expect(body.studentId).toMatch(/^[0-9a-f-]{36}$/);
    });

    it('creates the student under the applicant’s name', async () => {
      expect(await studentsNamed(applications.accepted.applicantName)).toEqual([
        body.studentId,
      ]);
    });

    it('marks the application accepted, by this user, for that student', async () => {
      const row = await applicationRow(applications.accepted);
      expect(row).toMatchObject({
        status: 'accepted',
        student_id: body.studentId,
        accepted_by: userEvents.id,
      });
      expect(row.accepted_at).toBeInstanceOf(Date);
    });

    it('writes one student.accepted event, undispatched, in the user’s name', async () => {
      const row = await applicationRow(applications.accepted);
      const events = await eventsFor(applications.accepted);
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        type: 'student.accepted',
        actor_user_id: userEvents.id,
        dispatched_at: null,
        payload: {
          applicationId: applications.accepted.id,
          studentId: body.studentId,
        },
      });
      // The event carries the instant the application records, in UTC.
      expect(events[0].payload.acceptedAt).toMatch(/Z$/);
      expect(new Date(events[0].payload.acceptedAt)).toEqual(row.accepted_at);
    });
  });

  describe('an application accepted twice', () => {
    it('answers 409 the second time and adds no student and no event', async () => {
      await accept(applications.twice).expect(201);
      const second = await accept(applications.twice).expect(409);
      expect(second.body).toEqual({
        statusCode: 409,
        code: 'ALREADY_ACCEPTED',
        message: 'Application already accepted',
      });
      expect(
        await studentsNamed(applications.twice.applicantName),
      ).toHaveLength(1);
      expect(await eventsFor(applications.twice)).toHaveLength(1);
    });
  });

  describe('two accepts at the same moment', () => {
    it('give one student, one event and one 409', async () => {
      const responses = await Promise.all([
        accept(applications.atOnce),
        accept(applications.atOnce),
      ]);
      expect(
        responses.map((response) => response.status).sort((a, b) => a - b),
      ).toEqual([201, 409]);
      const students = await studentsNamed(applications.atOnce.applicantName);
      expect(students).toHaveLength(1);
      const events = await eventsFor(applications.atOnce);
      expect(events).toHaveLength(1);
      expect(events[0].payload.studentId).toBe(students[0]);
      expect(await applicationRow(applications.atOnce)).toMatchObject({
        status: 'accepted',
        student_id: students[0],
      });
    });

    // The pair above can run one after the other by chance. This holds the
    // application's row lock, so the accept is known to be waiting on it.
    it('waits for a transaction that holds the application, then decides on what it left', async () => {
      const holder = await pool.connect();
      let settled = false;
      try {
        await holder.query('begin');
        await holder.query("select set_config('app.tenant_id', $1, true)", [
          school.id,
        ]);
        await holder.query(
          'select status from admission_applications where id = $1 for update',
          [applications.locked.id],
        );
        const waiting = accept(applications.locked).then((response) => {
          settled = true;
          return response;
        });
        await sleep(300);
        expect(settled).toBe(false);

        await holder.query('rollback');
        expect((await waiting).status).toBe(201);
      } finally {
        await holder.query('rollback');
        holder.release();
      }
      expect(await eventsFor(applications.locked)).toHaveLength(1);
    });
  });
});
