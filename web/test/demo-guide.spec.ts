import { describe, expect, it } from 'vitest';
import * as seed from '../../db/seed';
import { demoGuide } from '../dev/demo-guide';
import { seedUsers } from '../dev/seed-users';

interface Access {
  tenantId: string;
  userId: string;
}

// The demo guide is the development sign-in page. It names users and schools
// the API will not list, so it is checked against the seed.
describe('the demo guide', () => {
  const users = Object.values(seed).filter(
    (value): value is { id: string; email: string } =>
      typeof value === 'object' && value !== null && 'email' in value,
  );
  // Every way the seed lets a user into a school: a membership or a grant.
  const access: Access[] = [
    ...seed.memberships,
    ...seed.membershipsCDE,
    ...seed.roleMemberships,
    ...seed.membershipsCalendar,
    ...seed.staffMembershipsCalendar,
    ...seed.demoMemberships,
    ...seed.grants,
    ...seed.demoGrants,
  ];
  const canOpen = (userId: string, schoolId: string) =>
    access.some((row) => row.userId === userId && row.tenantId === schoolId);
  const group = (id: string) => demoGuide.find((entry) => entry.id === id)!;
  const entries = demoGuide.flatMap((entry) => entry.entries);
  const { yasmin, rayhan, sindyan, ghadeer, murooj } = seed.demoSchools;

  it('has one group per proof, in the order of the proofs, and the invoices last', () => {
    expect(demoGuide.map((entry) => entry.id)).toEqual([
      'isolation',
      'modules',
      'permissions',
      'ledger',
      'events',
      'invoices',
    ]);
  });

  it('names seeded users by their seeded email', () => {
    expect(entries.length).toBeGreaterThanOrEqual(10);
    for (const entry of entries) {
      expect(users).toContainEqual({ id: entry.userId, email: entry.email });
    }
  });

  it('lands each user in a school they can open, on a page of that school', () => {
    for (const entry of entries) {
      expect(`${entry.id}: ${canOpen(entry.userId, entry.schoolId)}`).toBe(
        `${entry.id}: true`,
      );
      expect(entry.path.startsWith(`/schools/${entry.schoolId}`)).toBe(true);
    }
  });

  it('gives every entry an id of its own', () => {
    const ids = entries.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('says what each group and each entry shows, in Arabic and in English', () => {
    for (const text of [
      ...demoGuide.map((entry) => entry.title),
      ...entries.map((entry) => entry.shows),
    ]) {
      expect(text.ar).toMatch(/[\u0600-\u06FF]/);
      expect(text.en).toMatch(/[A-Za-z]/);
      expect(text.en).not.toMatch(/[\u0600-\u06FF]/);
    }
  });

  it('opens the isolation proof on the students of Yasmin, with a school that is not the user’s ready to try', () => {
    const [entry] = group('isolation').entries;
    expect(entry.userId).toBe(seed.userDemoPrincipal.id);
    expect(entry.path).toBe(`/schools/${yasmin.id}/students?try=${sindyan.id}`);
    expect(canOpen(entry.userId, sindyan.id)).toBe(false);
    expect(canOpen(entry.userId, rayhan.id)).toBe(true);
  });

  it('opens the modules proof as one user in a school with finance on and in one with finance off', () => {
    const shown = group('modules').entries;
    expect(shown.map((entry) => entry.schoolId)).toEqual([
      yasmin.id,
      rayhan.id,
    ]);
    expect(new Set(shown.map((entry) => entry.userId))).toEqual(
      new Set([seed.userDemoPrincipal.id]),
    );
    for (const entry of shown) {
      expect(entry.path).toBe(`/schools/${entry.schoolId}`);
    }
  });

  it('opens the permissions proof in one school as an admin, a staff member and the group admin', () => {
    const shown = group('permissions').entries;
    expect(shown.map((entry) => entry.userId)).toEqual([
      seed.userDemoPrincipal.id,
      seed.userDemoTeacher.id,
      seed.userDemoGroupAdmin.id,
    ]);
    for (const entry of shown) {
      expect(entry.path).toBe(`/schools/${yasmin.id}`);
    }
  });

  it('opens the ledger proof on Yasmin’s ledger', () => {
    expect(group('ledger').entries.map((entry) => entry.path)).toEqual([
      `/schools/${yasmin.id}/ledger`,
    ]);
  });

  it('opens the events proof on the applications of the fee school and of the webhook school', () => {
    expect(group('events').entries.map((entry) => entry.path)).toEqual([
      `/schools/${ghadeer.id}/admissions`,
      `/schools/${murooj.id}/admissions`,
    ]);
  });

  it('keeps every invoice demo of the sign-in list, each on its invoices', () => {
    const shown = group('invoices').entries;
    expect(
      shown.map((entry) => [entry.userId, entry.schoolId, entry.path]),
    ).toEqual(
      seedUsers.map((user) => [
        user.userId,
        user.schoolId,
        `/schools/${user.schoolId}/invoices`,
      ]),
    );
  });
});
