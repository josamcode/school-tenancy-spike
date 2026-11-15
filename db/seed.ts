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
  statusFee: eventSchool(33, 'Status Fee School', {
    admissions: true,
    finance: true,
  }),
  statusHook: eventSchool(34, 'Status Hook School', { admissions: true }),
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
  statusFee: application(eventSchools.statusFee, 1, 'Applicant Status Fee'),
  statusPending: application(
    eventSchools.statusFee,
    2,
    'Applicant Status Pending',
  ),
  statusHook: application(eventSchools.statusHook, 1, 'Applicant Status Hook'),
  statusHookRetry: application(
    eventSchools.statusHook,
    2,
    'Applicant Status Retry',
  ),
};

// Calendar schools: finance on, two students each, one whose name is written
// in Latin letters and one in Arabic. They are only read, except the last
// three, which one test file each writes.
const calendarSchool = (
  n: number,
  name: string,
  nameAr: string | null,
  country: string | null,
  timezone: string,
) => ({
  id: `ca100000-0000-4000-8000-00000000000${n}`,
  name,
  nameI18n: nameAr === null ? null : { ar: nameAr, en: name },
  country,
  timezone,
  students: {
    latin: {
      id: `ca100000-0000-4000-8000-0000000${n}0101`,
      fullName: 'Omar Al Farsi',
    },
    arabic: {
      id: `ca100000-0000-4000-8000-0000000${n}0102`,
      fullName: 'ليلى حسن',
    },
  },
});
export const calendarSchools = {
  dubai: calendarSchool(
    1,
    'Al Noor International School',
    'مدرسة النور الدولية',
    'AE',
    'Asia/Dubai',
  ),
  riyadh: calendarSchool(
    2,
    'Al Faisal School',
    'مدرسة الفيصل',
    'SA',
    'Asia/Riyadh',
  ),
  muscat: calendarSchool(
    3,
    'Al Bustan School',
    'مدرسة البستان',
    'OM',
    'Asia/Muscat',
  ),
  manama: calendarSchool(
    4,
    'Al Hidd School',
    'مدرسة الحد',
    'BH',
    'Asia/Bahrain',
  ),
  kuwait: calendarSchool(
    5,
    'Al Salam School',
    'مدرسة السلام',
    'KW',
    'Asia/Kuwait',
  ),
  // No country and no translated name: the calculated calendar and the
  // plain name are what is left.
  noCountry: calendarSchool(6, 'Al Amal School', null, null, 'Asia/Dubai'),
  rules: calendarSchool(7, 'Invoice Rules School', null, 'AE', 'Asia/Dubai'),
  numbering: calendarSchool(
    8,
    'Invoice Numbering School',
    null,
    'AE',
    'Asia/Dubai',
  ),
  numberingOther: calendarSchool(
    9,
    'Invoice Numbering Other School',
    null,
    'AE',
    'Asia/Dubai',
  ),
};
export const userCalendar = {
  id: 'ca100000-0000-4000-8000-0000000000a1',
  email: 'accountant@calendar.test',
};
// Staff in the Dubai school, so they hold students:read and nothing else.
export const userCalendarStaff = {
  id: 'ca100000-0000-4000-8000-0000000000a2',
  email: 'teacher@calendar.test',
};
export const membershipsCalendar = Object.values(calendarSchools).map(
  (school) => ({ tenantId: school.id, userId: userCalendar.id }),
);
export const staffMembershipsCalendar = [
  {
    tenantId: calendarSchools.dubai.id,
    userId: userCalendarStaff.id,
    role: 'staff',
  },
];

// Test fixtures, not a record of real announcements. Oman starts Shawwal 1446
// a day after the calculated calendar and Bahrain starts Shawwal 1447 a day
// before it. Kuwait's row is a data-entry error: it would give Ramadan 1447
// 31 days.
export const hijriOverrides = [
  { country: 'OM', hijriYear: 1446, hijriMonth: 10, startsOn: '2025-03-31' },
  { country: 'BH', hijriYear: 1447, hijriMonth: 10, startsOn: '2026-03-19' },
  { country: 'KW', hijriYear: 1447, hijriMonth: 10, startsOn: '2026-03-21' },
];

const calendarInvoice = (
  school: (typeof calendarSchools)[keyof typeof calendarSchools],
  k: number,
  student: 'latin' | 'arabic',
  amount: string,
  currency: string,
  issuedAt: string,
  dueDate: string | null,
  description: { ar: string; en: string } | null,
) => ({
  id: `${school.id.slice(0, -5)}${school.id.slice(-1)}020${k}`,
  tenantId: school.id,
  studentId: school.students[student].id,
  amount,
  currency,
  issuedAt,
  dueDate,
  description,
});
const tuition = {
  ar: 'الرسوم الدراسية للفصل الثالث',
  en: 'Tuition fee, term 3',
};
const transport = { ar: 'رسوم النقل المدرسي', en: 'School transport fee' };
// Each school's invoices are inserted in this order, so the first is number
// 1. Two instants are shared: 2026-03-19T20:30Z is 20 March in Dubai and 19
// March in Riyadh, and 2025-03-30T06:00Z is 30 March in Dubai and in Muscat.
export const calendarInvoices = {
  dubaiEid: calendarInvoice(
    calendarSchools.dubai,
    1,
    'latin',
    '12500.0000',
    'AED',
    '2026-03-19T20:30:00Z',
    '2026-04-17',
    tuition,
  ),
  dubaiPlain: calendarInvoice(
    calendarSchools.dubai,
    2,
    'arabic',
    '750.0000',
    'AED',
    '2025-03-30T06:00:00Z',
    '2025-04-28',
    transport,
  ),
  riyadhEid: calendarInvoice(
    calendarSchools.riyadh,
    1,
    'latin',
    '9800.0000',
    'SAR',
    '2026-03-19T20:30:00Z',
    '2026-04-17',
    tuition,
  ),
  muscatEid: calendarInvoice(
    calendarSchools.muscat,
    1,
    'latin',
    '450.2500',
    'OMR',
    '2025-03-30T06:00:00Z',
    '2025-04-28',
    tuition,
  ),
  manamaEid: calendarInvoice(
    calendarSchools.manama,
    1,
    'latin',
    '1234.5000',
    'BHD',
    '2026-03-19T09:00:00Z',
    '2026-04-17',
    tuition,
  ),
  kuwaitEid: calendarInvoice(
    calendarSchools.kuwait,
    1,
    'latin',
    '300.0000',
    'KWD',
    '2026-03-20T09:00:00Z',
    null,
    tuition,
  ),
  // Issued before the wrong override can reach, and due inside its reach.
  kuwaitMixed: calendarInvoice(
    calendarSchools.kuwait,
    2,
    'arabic',
    '120.5000',
    'KWD',
    '2026-02-10T09:00:00Z',
    '2026-03-20',
    transport,
  ),
  noCountry: calendarInvoice(
    calendarSchools.noCountry,
    1,
    'latin',
    '100.0000',
    'AED',
    '2026-03-19T09:00:00Z',
    null,
    null,
  ),
};

// Demo schools: what the screens show. Yasmin, Rayhan and Sindyan are only
// read. Ghadeer and Murooj are written by accepting an application, by one
// browser test file and by whoever runs the demo.
const demoId = (n: number, kind: string, k: number) =>
  `de700000-0000-4000-8000-00${n}${kind}${String(k).padStart(7, '0')}`;
const demoSchool = (
  n: number,
  name: string,
  nameAr: string,
  students: string[],
) => ({
  id: `de700000-0000-4000-8000-00000000000${n}`,
  name,
  nameI18n: { ar: nameAr, en: name },
  country: 'AE',
  timezone: 'Asia/Dubai',
  students: students.map((fullName, index) => ({
    id: `de700000-0000-4000-8000-0000000${n}010${index + 1}`,
    fullName,
  })),
});
export const demoSchools = {
  // Finance and admissions on. Holds the ledger scenario.
  yasmin: demoSchool(1, 'Al Yasmin School', 'مدرسة الياسمين', [
    'سالم الهاشمي',
    'تالا الزعابي',
  ]),
  // A finance row that is switched off.
  rayhan: demoSchool(2, 'Al Rayhan School', 'مدرسة الريحان', [
    'خالد السويدي',
    'نورة المهيري',
  ]),
  // The demo users have no access to it.
  sindyan: demoSchool(3, 'Al Sindyan School', 'مدرسة السنديان', [
    'ماجد العتيبي',
    'ريم القحطاني',
  ]),
  // Admissions and finance on: an acceptance is charged the registration fee.
  ghadeer: demoSchool(4, 'Al Ghadeer School', 'مدرسة الغدير', []),
  // Admissions on and finance off: an acceptance goes to the webhook.
  murooj: demoSchool(5, 'Al Murooj School', 'مدرسة المروج', []),
};
export const userDemoPrincipal = {
  id: 'de700000-0000-4000-8000-0000000000a1',
  email: 'principal@alyasmin.test',
};
export const userDemoTeacher = {
  id: 'de700000-0000-4000-8000-0000000000a2',
  email: 'teacher@alyasmin.test',
};
// No membership anywhere. Holds finance:read in Yasmin through a grant, and
// administers a group that also contains Rayhan, which gives nothing.
export const userDemoGroupAdmin = {
  id: 'de700000-0000-4000-8000-0000000000a3',
  email: 'admin@yasmin-group.test',
};
export const userDemoSindyan = {
  id: 'de700000-0000-4000-8000-0000000000a4',
  email: 'principal@alsindyan.test',
};
export const demoMemberships = [
  ...[
    demoSchools.yasmin,
    demoSchools.rayhan,
    demoSchools.ghadeer,
    demoSchools.murooj,
  ].map((school) => ({
    tenantId: school.id,
    userId: userDemoPrincipal.id,
    role: 'school_admin',
  })),
  {
    tenantId: demoSchools.yasmin.id,
    userId: userDemoTeacher.id,
    role: 'staff',
  },
  {
    tenantId: demoSchools.sindyan.id,
    userId: userDemoSindyan.id,
    role: 'school_admin',
  },
];
export const demoGrants = [
  {
    tenantId: demoSchools.yasmin.id,
    userId: userDemoGroupAdmin.id,
    permission: 'finance:read',
  },
];
export const demoGroup = {
  id: 'de710000-0000-4000-8000-000000000001',
  name: 'Yasmin Schools Group',
  schools: [demoSchools.yasmin.id, demoSchools.rayhan.id],
};

const [salem, tala] = demoSchools.yasmin.students;
export const demoInvoices = {
  salem: {
    id: demoId(1, 'f0', 1),
    studentId: salem.id,
    amount: '1000.0000',
    currency: 'AED',
    issuedAt: '2025-12-10T06:00:00Z',
    dueDate: '2026-01-10',
    description: tuition,
  },
  tala: {
    id: demoId(1, 'f0', 2),
    studentId: tala.id,
    amount: '500.0000',
    currency: 'AED',
    issuedAt: '2025-12-10T06:00:00Z',
    dueDate: '2026-01-10',
    description: tuition,
  },
};

// Yasmin's books: the netting scenario of the ledger tests, entry for entry,
// with December 2025 locked afterwards.
const demoAccounts = {
  bankAed: ['1010', 'Bank AED', 'asset', 'AED', false],
  bankBhd: ['1020', 'Bank BHD', 'asset', 'BHD', false],
  bankSar: ['1030', 'Bank SAR', 'asset', 'SAR', false],
  receivables: ['1100', 'Receivables control', 'asset', 'AED', true],
  fxBhd: ['1901', 'FX position BHD', 'asset', 'BHD', false],
  fxBhdAed: ['1902', 'FX position BHD (AED)', 'asset', 'AED', false],
  fxSar: ['1903', 'FX position SAR', 'asset', 'SAR', false],
  fxSarAed: ['1904', 'FX position SAR (AED)', 'asset', 'AED', false],
  tuition: ['4000', 'Tuition income', 'income', 'AED', false],
  lateFees: ['4100', 'Late fee income', 'income', 'AED', false],
  discounts: ['4900', 'Sibling discounts', 'expense', 'AED', false],
  fxGainLoss: ['7900', 'FX gain or loss', 'income', 'AED', false],
} as const;
type DemoAccount = keyof typeof demoAccounts;
const demoAccountId = (key: DemoAccount) =>
  demoId(1, 'ac', Object.keys(demoAccounts).indexOf(key) + 1);
const demoYears = [
  {
    id: demoId(1, 'fa', 1),
    name: 'FY2025',
    start: '2025-01-01',
    end: '2025-12-31',
  },
  {
    id: demoId(1, 'fa', 2),
    name: 'FY2026',
    start: '2026-01-01',
    end: '2026-12-31',
  },
];
const demoPeriods = {
  dec2025: {
    id: demoId(1, 'be', 1),
    year: 0,
    start: '2025-12-01',
    end: '2025-12-31',
  },
  jan2026: {
    id: demoId(1, 'be', 2),
    year: 1,
    start: '2026-01-01',
    end: '2026-01-31',
  },
};
// AED per unit of the foreign currency.
const demoRates = [
  ['BHD', '2026-01-01', '9.7500'],
  ['BHD', '2026-01-15', '9.8000'],
  ['SAR', '2026-01-01', '0.9800'],
  ['SAR', '2026-01-31', '0.9790'],
];
type DemoLine = [account: DemoAccount, amount: string, studentId?: string];
interface DemoEntry {
  period: keyof typeof demoPeriods;
  date: string;
  kind: string;
  invoiceId?: string;
  reverses?: number;
  fx?: [currency: string, rate: string];
  lines: DemoLine[];
}
const demoEntries: DemoEntry[] = [
  {
    period: 'dec2025',
    date: '2025-12-10',
    kind: 'invoice',
    invoiceId: demoInvoices.salem.id,
    lines: [
      ['receivables', '1000.00', salem.id],
      ['tuition', '-1000.00'],
    ],
  },
  {
    period: 'dec2025',
    date: '2025-12-10',
    kind: 'discount',
    invoiceId: demoInvoices.salem.id,
    lines: [
      ['discounts', '100.00'],
      ['receivables', '-100.00', salem.id],
    ],
  },
  {
    period: 'dec2025',
    date: '2025-12-10',
    kind: 'invoice',
    invoiceId: demoInvoices.tala.id,
    lines: [
      ['receivables', '500.00', tala.id],
      ['tuition', '-500.00'],
    ],
  },
  {
    period: 'jan2026',
    date: '2026-01-08',
    kind: 'payment',
    fx: ['BHD', '9.7500'],
    lines: [
      ['bankBhd', '100.000'],
      ['fxBhd', '-100.000'],
      ['receivables', '-975.00', salem.id],
      ['fxBhdAed', '975.00'],
    ],
  },
  {
    period: 'jan2026',
    date: '2026-01-12',
    kind: 'payment',
    fx: ['SAR', '0.9800'],
    lines: [
      ['bankSar', '300.00'],
      ['fxSar', '-300.00'],
      ['receivables', '-294.00', tala.id],
      ['fxSarAed', '294.00'],
    ],
  },
  {
    period: 'dec2025',
    date: '2025-12-31',
    kind: 'late_fee',
    invoiceId: demoInvoices.salem.id,
    lines: [
      ['receivables', '50.00', salem.id],
      ['lateFees', '-50.00'],
    ],
  },
  {
    period: 'jan2026',
    date: '2026-01-25',
    kind: 'reversal',
    invoiceId: demoInvoices.salem.id,
    // The late fee, which is the sixth entry.
    reverses: 6,
    lines: [
      ['receivables', '-50.00', salem.id],
      ['lateFees', '50.00'],
    ],
  },
  {
    period: 'jan2026',
    date: '2026-01-26',
    kind: 'refund',
    fx: ['BHD', '9.8000'],
    lines: [
      ['bankBhd', '-7.653'],
      ['fxBhd', '7.653'],
      ['receivables', '75.00', salem.id],
      ['fxBhdAed', '-75.00'],
    ],
  },
  {
    period: 'jan2026',
    date: '2026-01-28',
    kind: 'fx_conversion',
    fx: ['BHD', '9.8000'],
    lines: [
      ['bankBhd', '-92.347'],
      ['fxBhd', '92.347'],
      ['bankAed', '905.00'],
      ['fxBhdAed', '-905.00'],
    ],
  },
  {
    period: 'jan2026',
    date: '2026-01-28',
    kind: 'fx_revaluation',
    fx: ['BHD', '9.8000'],
    lines: [
      ['fxBhdAed', '5.00'],
      ['fxGainLoss', '-5.00'],
    ],
  },
  {
    period: 'jan2026',
    date: '2026-01-31',
    kind: 'fx_revaluation',
    fx: ['SAR', '0.9790'],
    lines: [
      ['fxSarAed', '-0.30'],
      ['fxGainLoss', '0.30'],
    ],
  },
];

// Ghadeer's books: what the registration fee needs. One open period per year,
// so an acceptance made on any day of the demo has a period to post into.
export const demoFee = { amount: '500.00', currency: 'AED' };
const ghadeerAccounts = {
  receivables: demoId(4, 'ac', 1),
  registration: demoId(4, 'ac', 2),
};
const ghadeerYears = [2026, 2027, 2028, 2029, 2030];

const applicants = [
  'يوسف المنصوري',
  'مريم الكعبي',
  'عبدالله الشامسي',
  'فاطمة النعيمي',
  'حمد المزروعي',
  'شيخة الظاهري',
];
const demoApplications = (school: { id: string }, n: number) =>
  applicants.map((applicantName, index) => ({
    id: demoId(n, 'a0', index + 1),
    tenantId: school.id,
    applicantName,
  }));
// Six pending applications in each. A database reset brings them back.
export const demoPending = {
  ghadeer: demoApplications(demoSchools.ghadeer, 4),
  murooj: demoApplications(demoSchools.murooj, 5),
};

// Where Murooj's webhook goes in development: the fake receiver that
// `pnpm dev` starts. The secret is a local development value.
export const demoReceiver = {
  port: 3300,
  url: 'http://127.0.0.1:3300/hooks',
  secret: 'whsec_ZGV2X29ubHlfZGVtb19yZWNlaXZlcl9zZWNyZXQhIQ==',
};

export interface SeedOptions {
  // Where Murooj's webhook endpoint points. The default is the receiver of
  // `pnpm dev`.
  receiverUrl?: string;
}

async function seedDemoBooks(
  client: pg.Client,
  receiverUrl: string,
): Promise<void> {
  const setTenant = (school: { id: string }) =>
    client.query("select set_config('app.tenant_id', $1, true)", [school.id]);

  await setTenant(demoSchools.yasmin);
  const posted = await client.query('select 1 from ledger_entries limit 1');
  // Entries cannot be inserted twice, and December is locked after the first
  // time, so a second run leaves the books alone.
  if (posted.rowCount === 0) {
    await client.query("select set_config('app.user_id', $1, true)", [
      userDemoPrincipal.id,
    ]);
    for (const year of demoYears) {
      await client.query(
        `insert into financial_years (id, name, start_date, end_date)
         values ($1, $2, $3, $4)`,
        [year.id, year.name, year.start, year.end],
      );
    }
    for (const period of Object.values(demoPeriods)) {
      await client.query(
        `insert into ledger_periods (id, year_id, start_date, end_date)
         values ($1, $2, $3, $4)`,
        [period.id, demoYears[period.year].id, period.start, period.end],
      );
    }
    for (const key of Object.keys(demoAccounts) as DemoAccount[]) {
      const [code, name, type, currency, isControl] = demoAccounts[key];
      await client.query(
        `insert into ledger_accounts (id, code, name, type, currency, is_control)
         values ($1, $2, $3, $4, $5, $6)`,
        [demoAccountId(key), code, name, type, currency, isControl],
      );
    }
    for (const [currency, date, rate] of demoRates) {
      await client.query(
        'insert into fx_rates (currency, rate_date, rate) values ($1, $2, $3)',
        [currency, date, rate],
      );
    }
    for (const [currency, foreign, base] of [
      ['BHD', 'fxBhd', 'fxBhdAed'],
      ['SAR', 'fxSar', 'fxSarAed'],
    ] as [string, DemoAccount, DemoAccount][]) {
      await client.query(
        `insert into fx_positions
           (currency, base_currency, foreign_account_id, base_account_id, gain_loss_account_id)
         values ($1, 'AED', $2, $3, $4)`,
        [
          currency,
          demoAccountId(foreign),
          demoAccountId(base),
          demoAccountId('fxGainLoss'),
        ],
      );
    }
    for (const [index, entry] of demoEntries.entries()) {
      const id = demoId(1, 'ee', index + 1);
      await client.query(
        `insert into ledger_entries
           (id, period_id, entry_date, kind, invoice_id, reverses_entry_id, fx_currency, fx_rate)
         values ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          id,
          demoPeriods[entry.period].id,
          entry.date,
          entry.kind,
          entry.invoiceId ?? null,
          entry.reverses === undefined ? null : demoId(1, 'ee', entry.reverses),
          entry.fx?.[0] ?? null,
          entry.fx?.[1] ?? null,
        ],
      );
      for (const [
        lineIndex,
        [account, amount, studentId],
      ] of entry.lines.entries()) {
        await client.query(
          `insert into ledger_lines
             (entry_id, line_no, account_id, currency, amount, student_id)
           values ($1, $2, $3, $4, $5, $6)`,
          [
            id,
            lineIndex + 1,
            demoAccountId(account),
            demoAccounts[account][3],
            amount,
            studentId ?? null,
          ],
        );
      }
    }
    // The balance check waits for the commit, when another school is set and
    // these lines are out of its sight. So it runs here, under this school.
    await client.query(
      'set constraints ledger_entry_balanced, ledger_line_balanced immediate',
    );
    await client.query(
      'set constraints ledger_entry_balanced, ledger_line_balanced deferred',
    );
    await client.query(
      "update ledger_periods set status = 'locked' where id = $1",
      [demoPeriods.dec2025.id],
    );
    await client.query("select set_config('app.user_id', '', true)");
  }

  await setTenant(demoSchools.ghadeer);
  for (const [id, code, name, type, isControl] of [
    [ghadeerAccounts.receivables, '1100', 'Receivables control', 'asset', true],
    [
      ghadeerAccounts.registration,
      '4200',
      'Registration fee income',
      'income',
      false,
    ],
  ]) {
    await client.query(
      `insert into ledger_accounts (id, code, name, type, currency, is_control)
       values ($1, $2, $3, $4, 'AED', $5)
       on conflict do nothing`,
      [id, code, name, type, isControl],
    );
  }
  for (const [index, year] of ghadeerYears.entries()) {
    await client.query(
      `insert into financial_years (id, name, start_date, end_date)
       values ($1, $2, $3, $4)
       on conflict do nothing`,
      [
        demoId(4, 'fa', index + 1),
        `FY${year}`,
        `${year}-01-01`,
        `${year}-12-31`,
      ],
    );
    await client.query(
      `insert into ledger_periods (id, year_id, start_date, end_date)
       values ($1, $2, $3, $4)
       on conflict do nothing`,
      [
        demoId(4, 'be', index + 1),
        demoId(4, 'fa', index + 1),
        `${year}-01-01`,
        `${year}-12-31`,
      ],
    );
  }
  await client.query(
    `insert into registration_fees
       (amount, currency, receivable_account_id, income_account_id)
     values ($1, $2, $3, $4)
     on conflict do nothing`,
    [
      demoFee.amount,
      demoFee.currency,
      ghadeerAccounts.receivables,
      ghadeerAccounts.registration,
    ],
  );

  await setTenant(demoSchools.murooj);
  await client.query(
    `insert into webhook_endpoints (url, secret) values ($1, $2)
     on conflict do nothing`,
    [receiverUrl, demoReceiver.secret],
  );
}

export async function seed(
  ownerUrl: string,
  options: SeedOptions = {},
): Promise<void> {
  const client = new pg.Client({ connectionString: ownerUrl });
  await client.connect();
  try {
    await client.query('begin');

    const schools: {
      id: string;
      name: string;
      nameI18n?: { ar: string; en: string } | null;
      country?: string | null;
      timezone?: string;
    }[] = [
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
      ...Object.values(calendarSchools),
      ...Object.values(demoSchools),
    ];
    for (const school of schools) {
      await client.query(
        `insert into tenants (id, name, timezone, country, name_i18n)
         values ($1, $2, $3, $4, $5)
         on conflict do nothing`,
        [
          school.id,
          school.name,
          school.timezone ?? 'Asia/Dubai',
          school.country ?? null,
          school.nameI18n ?? null,
        ],
      );
    }
    for (const override of hijriOverrides) {
      await client.query(
        `insert into hijri_month_overrides (country, hijri_year, hijri_month, starts_on)
         values ($1, $2, $3, $4)
         on conflict do nothing`,
        [
          override.country,
          override.hijriYear,
          override.hijriMonth,
          override.startsOn,
        ],
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
      userCalendar,
      userCalendarStaff,
      userDemoPrincipal,
      userDemoTeacher,
      userDemoGroupAdmin,
      userDemoSindyan,
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
      ...membershipsCalendar,
    ].map((membership) => ({ ...membership, role: 'school_admin' }));
    const staff = [
      ...roleMemberships,
      {
        tenantId: eventSchools.accept.id,
        userId: userEventsStaff.id,
        role: 'staff',
      },
      ...staffMembershipsCalendar,
    ];
    for (const membership of [...admins, ...staff, ...demoMemberships]) {
      await client.query(
        'insert into memberships (tenant_id, user_id, role) values ($1, $2, $3) on conflict do nothing',
        [membership.tenantId, membership.userId, membership.role],
      );
    }
    for (const grant of [...grants, ...demoGrants]) {
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
    await client.query(
      'insert into groups (id, name) values ($1, $2) on conflict do nothing',
      [demoGroup.id, demoGroup.name],
    );
    for (const tenantId of demoGroup.schools) {
      await client.query(
        'insert into group_schools (group_id, tenant_id) values ($1, $2) on conflict do nothing',
        [demoGroup.id, tenantId],
      );
    }
    await client.query(
      'insert into group_admins (group_id, user_id) values ($1, $2) on conflict do nothing',
      [demoGroup.id, userDemoGroupAdmin.id],
    );

    // finance: true or false writes a row; undefined leaves the school with no row.
    const tenantData: {
      school: { id: string };
      finance?: boolean;
      admissions?: boolean;
      baseCurrency?: string;
      students?: { id: string; fullName: string }[];
      invoices?: {
        id: string;
        studentId: string;
        amount: string;
        currency: string;
        issuedAt?: string;
        dueDate?: string | null;
        description?: { ar: string; en: string } | null;
      }[];
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
      ...Object.values(calendarSchools).map((school) => ({
        school,
        finance: true,
        students: Object.values(school.students),
        invoices: Object.values(calendarInvoices).filter(
          (invoice) => invoice.tenantId === school.id,
        ),
      })),
      {
        school: demoSchools.yasmin,
        finance: true,
        admissions: true,
        baseCurrency: 'AED',
        students: demoSchools.yasmin.students,
        invoices: Object.values(demoInvoices),
      },
      {
        school: demoSchools.rayhan,
        finance: false,
        students: demoSchools.rayhan.students,
      },
      { school: demoSchools.sindyan, students: demoSchools.sindyan.students },
      {
        school: demoSchools.ghadeer,
        finance: true,
        admissions: true,
        baseCurrency: 'AED',
      },
      { school: demoSchools.murooj, finance: false, admissions: true },
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
      // Only the owner can name issued_at. Left out, it is the clock.
      for (const invoice of invoices) {
        await client.query(
          `insert into invoices
             (id, student_id, amount, currency, issued_at, due_date, description)
           values ($1, $2, $3, $4, $5, $6, $7)
           on conflict do nothing`,
          [
            invoice.id,
            invoice.studentId,
            invoice.amount,
            invoice.currency,
            invoice.issuedAt ?? null,
            invoice.dueDate ?? null,
            invoice.description ?? null,
          ],
        );
      }
    }

    await seedDemoBooks(client, options.receiverUrl ?? demoReceiver.url);

    for (const application of [
      ...Object.values(applications),
      ...demoPending.ghadeer,
      ...demoPending.murooj,
    ]) {
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
