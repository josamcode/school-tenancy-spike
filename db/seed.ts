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

export const modules = ['finance'];

export async function seed(ownerUrl: string): Promise<void> {
  const client = new pg.Client({ connectionString: ownerUrl });
  await client.connect();
  try {
    await client.query('begin');

    for (const school of [schoolA, schoolB]) {
      await client.query(
        'insert into tenants (id, name) values ($1, $2) on conflict do nothing',
        [school.id, school.name],
      );
    }
    for (const user of [userA, userB, userBoth]) {
      await client.query(
        'insert into users (id, email) values ($1, $2) on conflict do nothing',
        [user.id, user.email],
      );
    }
    for (const membership of memberships) {
      await client.query(
        'insert into memberships (tenant_id, user_id) values ($1, $2) on conflict do nothing',
        [membership.tenantId, membership.userId],
      );
    }

    const tenantData = [
      { school: schoolA, students: studentsA, invoices: invoicesA },
      { school: schoolB, students: studentsB, invoices: invoicesB },
    ];
    for (const { school, students, invoices } of tenantData) {
      // Tenant data goes through the same policy as every other write.
      await client.query("select set_config('app.tenant_id', $1, true)", [
        school.id,
      ]);
      for (const module of modules) {
        await client.query(
          'insert into tenant_modules (module, enabled) values ($1, true) on conflict do nothing',
          [module],
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
