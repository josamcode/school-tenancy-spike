import { describe, expect, it } from 'vitest';
import * as seed from '../../db/seed';
import { seedUsers } from '../dev/seed-users';

// The sign-in list is the one thing the app does not read from the API, which
// cannot list users. It must name users and schools that the seed creates.
describe('the demo sign-in list', () => {
  const users = [
    seed.userA,
    seed.userB,
    seed.userBoth,
    seed.userCalendar,
    seed.userCalendarStaff,
  ];
  const memberships = [
    ...seed.memberships,
    ...seed.membershipsCalendar,
    ...seed.staffMembershipsCalendar,
  ];

  it('is not empty', () => {
    expect(seedUsers.length).toBeGreaterThanOrEqual(3);
  });

  it('names seeded users by their seeded email', () => {
    for (const entry of seedUsers) {
      expect(users).toContainEqual({ id: entry.userId, email: entry.email });
    }
  });

  it('sends each user to a school they are a member of', () => {
    for (const entry of seedUsers) {
      expect(
        memberships.some(
          (membership) =>
            membership.userId === entry.userId &&
            membership.tenantId === entry.schoolId,
        ),
      ).toBe(true);
    }
  });

  it('has no entry twice', () => {
    const keys = seedUsers.map((entry) => `${entry.userId} ${entry.schoolId}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
