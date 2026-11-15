import pg from 'pg';

export const schoolA = {
  id: 'a0000000-0000-4000-8000-000000000001',
  name: 'Al Noor School',
};
export const schoolB = {
  id: 'b0000000-0000-4000-8000-000000000001',
  name: 'Al Bayan School',
};

export const userA = {
  id: 'a0000000-0000-4000-8000-0000000000a1',
  email: 'registrar@alnoor.test',
};
export const userB = {
  id: 'b0000000-0000-4000-8000-0000000000b1',
  email: 'registrar@albayan.test',
};
export const userBoth = {
  id: 'c0000000-0000-4000-8000-0000000000c1',
  email: 'group.admin@schools.test',
};

export const memberships = [
  { tenantId: schoolA.id, userId: userA.id },
  { tenantId: schoolB.id, userId: userB.id },
  { tenantId: schoolA.id, userId: userBoth.id },
  { tenantId: schoolB.id, userId: userBoth.id },
];

export const studentsA = [
  { id: 'a0000000-0000-4000-8000-000000000101', fullName: 'Omar Al Farsi' },
  { id: 'a0000000-0000-4000-8000-000000000102', fullName: 'Layla Hassan' },
];
export const studentsB = [
  {
    id: 'b0000000-0000-4000-8000-000000000101',
    fullName: 'Yousef Al Mansoori',
  },
  { id: 'b0000000-0000-4000-8000-000000000102', fullName: 'Mariam Saeed' },
];

export const invoicesA = [
  {
    id: 'a0000000-0000-4000-8000-000000000201',
    studentId: studentsA[0].id,
    amount: '12500.0000',
    currency: 'AED',
  },
];
export const invoicesB = [
  {
    id: 'b0000000-0000-4000-8000-000000000201',
    studentId: studentsB[0].id,
    amount: '9800.0000',
    currency: 'AED',
  },
];

// Schools for the module entitlement tests. Finance is on for A and B.
// C has a finance row that is switched off and D has no finance row; both are
// only read. E is written by one test and read by nothing else.
export const schoolC = {
  id: 'c1000000-0000-4000-8000-000000000001',
  name: 'Al Reef School',
};
export const schoolD = {
  id: 'd0000000-0000-4000-8000-000000000001',
  name: 'Al Waha School',
};
export const schoolE = {
  id: 'e0000000-0000-4000-8000-000000000001',
  name: 'Al Manar School',
};
export const userCDE = {
  id: 'cde00000-0000-4000-8000-0000000000e1',
  email: 'registrar@reef-waha-manar.test',
};
export const membershipsCDE = [schoolC, schoolD, schoolE].map((school) => ({
  tenantId: school.id,
  userId: userCDE.id,
}));
export const studentsC = [
  { id: 'c1000000-0000-4000-8000-000000000101', fullName: 'Noura Al Ketbi' },
];

export async function seed(ownerUrl: string): Promise<void> {
  const client = new pg.Client({ connectionString: ownerUrl });
  await client.connect();
  try {
    await client.query('begin');

    for (const school of [schoolA, schoolB, schoolC, schoolD, schoolE]) {
      await client.query(
        'insert into tenants (id, name) values ($1, $2) on conflict do nothing',
        [school.id, school.name],
      );
    }
    for (const user of [userA, userB, userBoth, userCDE]) {
      await client.query(
        'insert into users (id, email) values ($1, $2) on conflict do nothing',
        [user.id, user.email],
      );
    }
    for (const membership of [...memberships, ...membershipsCDE]) {
      await client.query(
        'insert into memberships (tenant_id, user_id) values ($1, $2) on conflict do nothing',
        [membership.tenantId, membership.userId],
      );
    }

    // finance: true or false writes a row; undefined leaves the school with no row.
    const tenantData: {
      school: { id: string };
      finance?: boolean;
      students?: { id: string; fullName: string }[];
      invoices?: typeof invoicesA;
    }[] = [
      {
        school: schoolA,
        finance: true,
        students: studentsA,
        invoices: invoicesA,
      },
      {
        school: schoolB,
        finance: true,
        students: studentsB,
        invoices: invoicesB,
      },
      { school: schoolC, finance: false, students: studentsC },
      { school: schoolD },
      { school: schoolE },
    ];
    for (const {
      school,
      finance,
      students = [],
      invoices = [],
    } of tenantData) {
      // Tenant data goes through the same policy as every other write.
      await client.query("select set_config('app.tenant_id', $1, true)", [
        school.id,
      ]);
      if (finance !== undefined) {
        await client.query(
          'insert into tenant_modules (module, enabled) values ($1, $2) on conflict do nothing',
          ['finance', finance],
        );
      }
      for (const student of students) {
        await client.query(
          'insert into students (id, full_name) values ($1, $2) on conflict do nothing',
          [student.id, student.fullName],
        );
      }
      for (const invoice of invoices) {
        await client.query(
          'insert into invoices (id, student_id, amount, currency) values ($1, $2, $3, $4) on conflict do nothing',
          [invoice.id, invoice.studentId, invoice.amount, invoice.currency],
        );
      }
    }

    await client.query('commit');
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    await client.end();
  }
}

if (import.meta.main) {
  const ownerUrl = process.env.MIGRATION_DATABASE_URL;
  if (!ownerUrl) throw new Error('MIGRATION_DATABASE_URL is not set');
  await seed(ownerUrl);
}
