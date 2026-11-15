import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types.js';
import {
  group,
  schoolA,
  schoolB,
  schoolC,
  schoolD,
  schoolF,
  schoolG,
  schoolH,
  studentsA,
  studentsB,
  studentsG,
  userA,
  userBoth,
  userGrantG,
  userGroupAdmin,
  userMemberG,
  userStaffA,
  userStaffDGrantH,
} from '../../db/seed.js';
import { AppModule } from '../../src/app.module.js';
import { asOwner, ownerPool } from '../support/db.js';
import { tokenFor } from '../support/tokens.js';

interface StudentRow {
  id: string;
  tenantId: string;
}

const permissionDenied = {
  statusCode: 403,
  code: 'PERMISSION_DENIED',
  message: 'Permission denied',
};
const moduleDisabled = {
  statusCode: 403,
  code: 'MODULE_DISABLED',
  message: 'Module disabled',
};

describe('access to a school', () => {
  let app: INestApplication<App>;
  let membership403: unknown;
  const tokens: Record<string, string> = {};

  const http = () => request(app.getHttpServer());
  const as = (user: { id: string }) => ({
    Authorization: `Bearer ${tokens[user.id]}`,
  });
  const students = (school: { id: string }) => `/schools/${school.id}/students`;
  const invoices = (school: { id: string }) => `/schools/${school.id}/invoices`;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    const users = [
      userA,
      userBoth,
      userStaffA,
      userGroupAdmin,
      userGrantG,
      userMemberG,
      userStaffDGrantH,
    ];
    for (const user of users) tokens[user.id] = await tokenFor(user.id);

    const response = await http().get(students(schoolB)).set(as(userA));
    expect(response.status).toBe(403);
    membership403 = response.body;
  });

  afterAll(async () => {
    await app.close();
  });

  function expectOnly(
    rows: StudentRow[],
    own: { id: string },
    ownStudents: { id: string }[],
    otherStudents: { id: string }[],
  ) {
    const ids = rows.map((row) => row.id);
    expect(ids).toEqual(expect.arrayContaining(ownStudents.map((s) => s.id)));
    expect(rows.every((row) => row.tenantId === own.id)).toBe(true);
    for (const student of otherStudents) expect(ids).not.toContain(student.id);
  }

  describe('one login across schools', () => {
    it('lets a member of A and B switch with the same token and see only the current school', async () => {
      const inA = await http().get(students(schoolA)).set(as(userBoth));
      const inB = await http().get(students(schoolB)).set(as(userBoth));
      const inAAgain = await http().get(students(schoolA)).set(as(userBoth));

      expect([inA.status, inB.status, inAAgain.status]).toEqual([
        200, 200, 200,
      ]);
      expectOnly(inA.body, schoolA, studentsA, studentsB);
      expectOnly(inB.body, schoolB, studentsB, studentsA);
      expectOnly(inAAgain.body, schoolA, studentsA, studentsB);
    });

    it('keeps the two schools apart when the same user asks for both at once', async () => {
      const calls = Array.from({ length: 20 }, (_, i) => {
        const school = i % 2 === 0 ? schoolA : schoolB;
        return http()
          .get(students(school))
          .set(as(userBoth))
          .then((response) => ({ school, response }));
      });
      for (const { school, response } of await Promise.all(calls)) {
        expect(response.status).toBe(200);
        if (school === schoolA) {
          expectOnly(response.body, schoolA, studentsA, studentsB);
        } else {
          expectOnly(response.body, schoolB, studentsB, studentsA);
        }
      }
    });
  });

  describe('a group admin whose only grant is students:read on B', () => {
    it('reads B’s students', async () => {
      const response = await http()
        .get(students(schoolB))
        .set(as(userGroupAdmin))
        .expect(200);
      expectOnly(response.body, schoolB, studentsB, studentsA);
    });

    it('gets 403 PERMISSION_DENIED on creating a student in B', async () => {
      const response = await http()
        .post(students(schoolB))
        .set(as(userGroupAdmin))
        .send({ fullName: 'Not Allowed' })
        .expect(403);
      expect(response.body).toEqual(permissionDenied);
    });

    it('gets 403 PERMISSION_DENIED on B’s invoices while finance is on for B', async () => {
      const response = await http()
        .get(invoices(schoolB))
        .set(as(userGroupAdmin))
        .expect(403);
      expect(response.body).toEqual(permissionDenied);
    });

    it('gets the plain membership 403 on A, which is in the same group', async () => {
      const onStudents = await http()
        .get(students(schoolA))
        .set(as(userGroupAdmin))
        .expect(403);
      const onInvoices = await http()
        .get(invoices(schoolA))
        .set(as(userGroupAdmin))
        .expect(403);
      expect(onStudents.body).toEqual(membership403);
      expect(onInvoices.body).toEqual(membership403);
    });
  });

  describe('adding a school to the group', () => {
    const linkExists = async () => {
      const pool = ownerPool();
      try {
        const { rows } = await pool.query(
          'select 1 from group_schools where group_id = $1 and tenant_id = $2',
          [group.id, schoolF.id],
        );
        return rows.length === 1;
      } finally {
        await pool.end();
      }
    };

    afterAll(async () => {
      await asOwner(async (client) => {
        await client.query(
          'delete from group_schools where group_id = $1 and tenant_id = $2',
          [group.id, schoolF.id],
        );
      });
    });

    it('gives the group admin no access to it', async () => {
      const before = await http()
        .get(students(schoolF))
        .set(as(userGroupAdmin));
      expect(before.status).toBe(403);
      expect(before.body).toEqual(membership403);

      await asOwner(async (client) => {
        await client.query(
          'insert into group_schools (group_id, tenant_id) values ($1, $2)',
          [group.id, schoolF.id],
        );
      });
      expect(await linkExists()).toBe(true);

      const after = await http().get(students(schoolF)).set(as(userGroupAdmin));
      expect(after.status).toBe(403);
      expect(after.body).toEqual(membership403);
    });
  });

  describe('a staff member', () => {
    it('reads students', async () => {
      const response = await http()
        .get(students(schoolA))
        .set(as(userStaffA))
        .expect(200);
      expectOnly(response.body, schoolA, studentsA, studentsB);
    });

    it('gets 403 PERMISSION_DENIED on creating a student, although they are an admin of another school', async () => {
      const response = await http()
        .post(students(schoolA))
        .set(as(userStaffA))
        .send({ fullName: 'Not Allowed' })
        .expect(403);
      expect(response.body).toEqual(permissionDenied);
    });

    it('gets 403 PERMISSION_DENIED on invoices where finance is on', async () => {
      const response = await http()
        .get(invoices(schoolA))
        .set(as(userStaffA))
        .expect(403);
      expect(response.body).toEqual(permissionDenied);
    });

    it('gets 403 MODULE_DISABLED before any permission answer where finance is off', async () => {
      const response = await http()
        .get(invoices(schoolC))
        .set(as(userStaffA))
        .expect(403);
      expect(response.body).toEqual(moduleDisabled);
    });
  });

  describe('a school admin', () => {
    it('can create a student', async () => {
      const response = await http()
        .post(students(schoolA))
        .set(as(userA))
        .send({ fullName: `Admin Created ${Date.now()}` })
        .expect(201);
      expect(response.body).toMatchObject({ tenantId: schoolA.id });
    });
  });

  // School H is written only by the first test below.
  describe('a user who is staff in D and holds a students:create grant in H', () => {
    it('can create a student in H, where the grant is', async () => {
      const response = await http()
        .post(students(schoolH))
        .set(as(userStaffDGrantH))
        .send({ fullName: `Grant Created ${Date.now()}` })
        .expect(201);
      expect(response.body).toMatchObject({ tenantId: schoolH.id });
    });

    it('gets 403 PERMISSION_DENIED on creating a student in D, where the grant does not apply', async () => {
      const response = await http()
        .post(students(schoolD))
        .set(as(userStaffDGrantH))
        .send({ fullName: 'Not Allowed' })
        .expect(403);
      expect(response.body).toEqual(permissionDenied);
    });
  });

  // School G is written only by the two tests below.
  describe('revoking a grant', () => {
    const grant = [schoolG.id, userGrantG.id, 'students:read'];

    afterAll(async () => {
      await asOwner(async (client) => {
        await client.query(
          `insert into grants (tenant_id, user_id, permission)
           values ($1, $2, $3) on conflict do nothing`,
          grant,
        );
      });
    });

    it('makes the next request return the plain membership 403', async () => {
      const before = await http().get(students(schoolG)).set(as(userGrantG));
      expect(before.status).toBe(200);
      expect(before.body.map((row: StudentRow) => row.id)).toEqual(
        expect.arrayContaining(studentsG.map((s) => s.id)),
      );

      await asOwner(async (client) => {
        await client.query(
          `delete from grants
            where tenant_id = $1 and user_id = $2 and permission = $3`,
          grant,
        );
      });

      const after = await http().get(students(schoolG)).set(as(userGrantG));
      expect(after.status).toBe(403);
      expect(after.body).toEqual(membership403);
    });
  });

  describe('removing a membership', () => {
    const membership = [schoolG.id, userMemberG.id];

    afterAll(async () => {
      await asOwner(async (client) => {
        await client.query(
          `insert into memberships (tenant_id, user_id, role)
           values ($1, $2, 'staff') on conflict do nothing`,
          membership,
        );
      });
    });

    it('makes the next request return the plain membership 403', async () => {
      const before = await http().get(students(schoolG)).set(as(userMemberG));
      expect(before.status).toBe(200);

      await asOwner(async (client) => {
        await client.query(
          'delete from memberships where tenant_id = $1 and user_id = $2',
          membership,
        );
      });

      const after = await http().get(students(schoolG)).set(as(userMemberG));
      expect(after.status).toBe(403);
      expect(after.body).toEqual(membership403);
    });
  });
});
