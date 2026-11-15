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

// Access fixtures. Every membership above has the role school_admin.
// This user is staff in A and school_admin in C, so a check that forgot the
// school would give them an admin's rights in A.
export const userStaffA = {
  id: 'a0000000-0000-4000-8000-0000000000a2',
  email: 'teacher@alnoor.test',
};
// F is added to the group by one test. G is written by the revoke and remove
// tests. Nothing else reads either of them.
export const schoolF = {
  id: 'f0000000-0000-4000-8000-000000000001',
  name: 'Al Safa School',
};
export const schoolG = {
  id: 'a9000000-0000-4000-8000-000000000001',
  name: 'Al Wadi School',
};
export const studentsG = [
  { id: 'a9000000-0000-4000-8000-000000000101', fullName: 'Hamad Al Nuaimi' },
];
export const userGroupAdmin = {
  id: '90000000-0000-4000-8000-0000000000d1',
  email: 'admin@northgroup.test',
};
export const userGrantG = {
  id: 'a9000000-0000-4000-8000-0000000000a1',
  email: 'auditor@alwadi.test',
};
export const userMemberG = {
  id: 'a9000000-0000-4000-8000-0000000000a2',
  email: 'teacher@alwadi.test',
};
// This user is staff in D and holds a students:create grant in H, so a check
// that forgot the school on a grant would let them create students in D.
// H is written only by the test that uses this grant.
export const schoolH = {
  id: 'ac000000-0000-4000-8000-000000000001',
  name: 'Al Qamar School',
};
export const userStaffDGrantH = {
  id: 'ac000000-0000-4000-8000-0000000000a1',
  email: 'coordinator@alqamar.test',
};
export const roleMemberships = [
  { tenantId: schoolA.id, userId: userStaffA.id, role: 'staff' },
  { tenantId: schoolC.id, userId: userStaffA.id, role: 'school_admin' },
  { tenantId: schoolG.id, userId: userMemberG.id, role: 'staff' },
  { tenantId: schoolD.id, userId: userStaffDGrantH.id, role: 'staff' },
];
export const grants = [
  {
    tenantId: schoolB.id,
    userId: userGroupAdmin.id,
    permission: 'students:read',
  },
  { tenantId: schoolG.id, userId: userGrantG.id, permission: 'students:read' },
  {
    tenantId: schoolH.id,
    userId: userStaffDGrantH.id,
    permission: 'students:create',
  },
];
// The group links A and B. Its admin has a grant on B only.
export const group = {
  id: '91000000-0000-4000-8000-000000000001',
  name: 'North Schools Group',
};
export const groupSchools = [schoolA.id, schoolB.id];

// Ledger schools: finance on, base currency AED, two students each. Each one
// is written by a single test file and read by nothing else.
const ledgerSchool = (n: number, name: string) => ({
  id: `1ed00000-0000-4000-8000-00000000000${n}`,
  name,
  students: {
    s: `1ed00000-0000-4000-8000-0000000${n}0101`,
    t: `1ed00000-0000-4000-8000-0000000${n}0102`,
  },
});
export const ledgerSchools = {
  scenario: ledgerSchool(1, 'Ledger Scenario School'),
  guarantees: ledgerSchool(2, 'Ledger Guarantees School'),
  concurrency: ledgerSchool(3, 'Ledger Concurrency School'),
  fx: ledgerSchool(4, 'Ledger FX School'),
};
export const userLedger = {
  id: '1ed00000-0000-4000-8000-0000000000a1',
  email: 'bursar@ledger.test',
};

export async function seed(ownerUrl: string): Promise<void> {
  const client = new pg.Client({ connectionString: ownerUrl });
  await client.connect();
  try {
    await client.query('begin');

    const schools = [
      schoolA,
      schoolB,
      schoolC,
      schoolD,
      schoolE,
      schoolF,
      schoolG,
      schoolH,
      ...Object.values(ledgerSchools),
    ];
    for (const school of schools) {
      await client.query(
        'insert into tenants (id, name) values ($1, $2) on conflict do nothing',
        [school.id, school.name],
      );
    }
    const users = [
      userA,
      userB,
      userBoth,
      userCDE,
      userStaffA,
      userGroupAdmin,
      userGrantG,
      userMemberG,
      userStaffDGrantH,
      userLedger,
    ];
    for (const user of users) {
      await client.query(
        'insert into users (id, email) values ($1, $2) on conflict do nothing',
        [user.id, user.email],
      );
    }
    const membershipsLedger = Object.values(ledgerSchools).map((school) => ({
      tenantId: school.id,
      userId: userLedger.id,
    }));
    const admins = [
      ...memberships,
      ...membershipsCDE,
      ...membershipsLedger,
    ].map((membership) => ({ ...membership, role: 'school_admin' }));
    for (const membership of [...admins, ...roleMemberships]) {
      await client.query(
        'insert into memberships (tenant_id, user_id, role) values ($1, $2, $3) on conflict do nothing',
        [membership.tenantId, membership.userId, membership.role],
      );
    }
    for (const grant of grants) {
      await client.query(
        'insert into grants (tenant_id, user_id, permission) values ($1, $2, $3) on conflict do nothing',
        [grant.tenantId, grant.userId, grant.permission],
      );
    }

    await client.query(
      'insert into groups (id, name) values ($1, $2) on conflict do nothing',
      [group.id, group.name],
    );
    for (const tenantId of groupSchools) {
      await client.query(
        'insert into group_schools (group_id, tenant_id) values ($1, $2) on conflict do nothing',
        [group.id, tenantId],
      );
    }
    await client.query(
      'insert into group_admins (group_id, user_id) values ($1, $2) on conflict do nothing',
      [group.id, userGroupAdmin.id],
    );

    // finance: true or false writes a row; undefined leaves the school with no row.
    const tenantData: {
      school: { id: string };
      finance?: boolean;
      baseCurrency?: string;
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
      { school: schoolF },
      { school: schoolG, students: studentsG },
      { school: schoolH },
      ...Object.values(ledgerSchools).map((school) => ({
        school,
        finance: true,
        baseCurrency: 'AED',
        students: [
          { id: school.students.s, fullName: 'Salem Al Hashmi' },
          { id: school.students.t, fullName: 'Tala Al Zaabi' },
        ],
      })),
    ];
    for (const {
      school,
      finance,
      baseCurrency,
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
      if (baseCurrency !== undefined) {
        await client.query(
          'insert into finance_settings (base_currency) values ($1) on conflict do nothing',
          [baseCurrency],
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
