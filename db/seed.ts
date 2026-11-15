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
  revaluation: ledgerSchool(5, 'Ledger Revaluation School'),
};
export const userLedger = {
  id: '1ed00000-0000-4000-8000-0000000000a1',
  email: 'bursar@ledger.test',
};

// Event schools: base currency AED and one student each. Each one is written
// by a single test and read by nothing else. finance: true or false writes a
// row; undefined leaves the school with no finance row.
const eventSchool = (
  n: number,
  name: string,
  modules: { admissions?: boolean; finance?: boolean } = {},
) => {
  const nn = n.toString(16).padStart(2, '0');
  return {
    id: `e5000000-0000-4000-8000-0000000000${nn}`,
    name,
    student: `e5000000-0000-4000-8000-00000000${nn}01`,
    ...modules,
  };
};
export const eventSchools = {
  accept: eventSchool(1, 'Accept School', { admissions: true }),
  acceptRollback: eventSchool(2, 'Accept Rollback School', {
    admissions: true,
  }),
  rolesOne: eventSchool(3, 'Event Roles School One'),
  rolesTwo: eventSchool(4, 'Event Roles School Two'),
  tables: eventSchool(5, 'Event Tables School', { finance: true }),
  financeTwice: eventSchool(6, 'Fee Twice School', { finance: true }),
  financeAtOnce: eventSchool(7, 'Fee At Once School', { finance: true }),
  financeCrash: eventSchool(8, 'Fee Crash School', { finance: true }),
  isolationOne: eventSchool(9, 'Handler Isolation School One'),
  isolationTwo: eventSchool(10, 'Handler Isolation School Two'),
  routeOff: eventSchool(11, 'Route Off School', { finance: false }),
  routeOn: eventSchool(12, 'Route On School', { finance: true }),
  switchOnOff: eventSchool(13, 'Switch On Off School', { finance: true }),
  switchOffOn: eventSchool(14, 'Switch Off On School', { finance: false }),
  switchWaits: eventSchool(15, 'Switch Waits School', { finance: true }),
  switchAfter: eventSchool(16, 'Switch After School', { finance: true }),
  hookSigned: eventSchool(17, 'Hook Signed School'),
  hookRetry: eventSchool(18, 'Hook Retry School'),
  hookFails: eventSchool(19, 'Hook Fails School'),
  hookPasses: eventSchool(20, 'Hook Passes School'),
  hookFee: eventSchool(21, 'Hook Fee School', { finance: true }),
  hookDead: eventSchool(22, 'Hook Dead School'),
  hookHandoff: eventSchool(23, 'Hook Handoff School'),
  hookHangs: eventSchool(24, 'Hook Hangs School'),
  hookHangFee: eventSchool(25, 'Hook Hang Fee School', { finance: true }),
  feeDate: eventSchool(26, 'Fee Date School', { finance: true }),
  dispatch: eventSchool(27, 'Dispatch School', { finance: true }),
  endToEnd: eventSchool(28, 'End To End School', { admissions: true }),
  tablesOther: eventSchool(29, 'Event Tables Other School'),
  hookNoEndpoint: eventSchool(30, 'Hook No Endpoint School'),
  failNoFee: eventSchool(31, 'Fail No Fee School', { finance: true }),
  failOther: eventSchool(32, 'Fail Other School', { finance: true }),
};
export const userEvents = {
  id: 'e5000000-0000-4000-8000-0000000000a1',
  email: 'registrar@events.test',
};
// Staff in the accept school, so they hold students:read and nothing else.
export const userEventsStaff = {
  id: 'e5000000-0000-4000-8000-0000000000a2',
  email: 'teacher@events.test',
};
const application = (school: { id: string }, k: number, name: string) => ({
  id: `${school.id.slice(0, -6)}${school.id.slice(-2)}0a0${k}`,
  tenantId: school.id,
  applicantName: name,
});
// Pending applications. Each is accepted by at most one test.
export const applications = {
  accepted: application(eventSchools.accept, 1, 'Applicant Accepted'),
  twice: application(eventSchools.accept, 2, 'Applicant Twice'),
  atOnce: application(eventSchools.accept, 3, 'Applicant At Once'),
  locked: application(eventSchools.accept, 4, 'Applicant Locked'),
  denied: application(eventSchools.accept, 5, 'Applicant Denied'),
  rolledBack: application(
    eventSchools.acceptRollback,
    1,
    'Applicant Rolled Back',
  ),
  kept: application(eventSchools.acceptRollback, 2, 'Applicant Kept'),
  overlapped: application(
    eventSchools.acceptRollback,
    3,
    'Applicant Overlapped',
  ),
  endToEnd: application(eventSchools.endToEnd, 1, 'Applicant End To End'),
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
      ...Object.values(eventSchools),
    ];
    for (const school of schools) {
      await client.query(
        `insert into tenants (id, name, timezone) values ($1, $2, 'Asia/Dubai')
         on conflict do nothing`,
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
      userEvents,
      userEventsStaff,
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
    const membershipsEvents = Object.values(eventSchools).map((school) => ({
      tenantId: school.id,
      userId: userEvents.id,
    }));
    const admins = [
      ...memberships,
      ...membershipsCDE,
      ...membershipsLedger,
      ...membershipsEvents,
    ].map((membership) => ({ ...membership, role: 'school_admin' }));
    const staff = [
      ...roleMemberships,
      {
        tenantId: eventSchools.accept.id,
        userId: userEventsStaff.id,
        role: 'staff',
      },
    ];
    for (const membership of [...admins, ...staff]) {
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
      admissions?: boolean;
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
      ...Object.values(eventSchools).map((school) => ({
        school,
        finance: school.finance,
        admissions: school.admissions,
        baseCurrency: 'AED',
        students: [{ id: school.student, fullName: 'Rashid Al Marri' }],
      })),
    ];
    for (const {
      school,
      finance,
      admissions,
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
      if (admissions !== undefined) {
        await client.query(
          'insert into tenant_modules (module, enabled) values ($1, $2) on conflict do nothing',
          ['admissions', admissions],
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

    for (const application of Object.values(applications)) {
      await client.query("select set_config('app.tenant_id', $1, true)", [
        application.tenantId,
      ]);
      await client.query(
        `insert into admission_applications (id, applicant_name) values ($1, $2)
         on conflict do nothing`,
        [application.id, application.applicantName],
      );
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
