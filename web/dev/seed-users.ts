// Development only. The demo sign-in offers these seed users, each with one
// of their schools. The API cannot list users, so this is the one list the
// app does not read from it. A test compares it with db/seed.ts.
export interface SeedUser {
  userId: string;
  email: string;
  schoolId: string;
  // What this pair is there to show.
  shows: string;
}

const accountant = {
  userId: 'ca100000-0000-4000-8000-0000000000a1',
  email: 'accountant@calendar.test',
};

export const seedUsers: SeedUser[] = [
  {
    ...accountant,
    schoolId: 'ca100000-0000-4000-8000-000000000001',
    shows: 'Dubai: the calculated calendar, and an Arabic student name',
  },
  {
    ...accountant,
    schoolId: 'ca100000-0000-4000-8000-000000000002',
    shows: 'Riyadh: the same instant as Dubai, dated a day earlier',
  },
  {
    ...accountant,
    schoolId: 'ca100000-0000-4000-8000-000000000003',
    shows: 'Muscat: Shawwal 1446 announced a day later than calculated',
  },
  {
    ...accountant,
    schoolId: 'ca100000-0000-4000-8000-000000000004',
    shows: 'Manama: BHD with 3 decimals, Shawwal 1447 announced a day early',
  },
  {
    userId: 'ca100000-0000-4000-8000-0000000000a2',
    email: 'teacher@calendar.test',
    schoolId: 'ca100000-0000-4000-8000-000000000001',
    shows: 'Staff in Dubai: no finance permission, so no invoices',
  },
  {
    userId: 'a0000000-0000-4000-8000-0000000000a1',
    email: 'registrar@alnoor.test',
    schoolId: 'a0000000-0000-4000-8000-000000000001',
    shows: 'An invoice with no description, no due date and no country',
  },
];
