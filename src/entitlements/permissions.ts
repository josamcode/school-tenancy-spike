import { Area, isArea } from './areas.js';

export type PermissionKey = `${Area}:${string}`;

// Must match the rows of the permissions table. A test compares the two.
export const PERMISSIONS = [
  'students:read',
  'students:create',
  'finance:read',
  'admissions:accept',
] as const satisfies readonly PermissionKey[];

export type Permission = (typeof PERMISSIONS)[number];

export function isPermission(value: unknown): value is Permission {
  return (PERMISSIONS as readonly unknown[]).includes(value);
}

// Undefined when the area is not declared, which the callers treat as an error.
export function areaOf(permission: string): Area | undefined {
  const area = permission.split(':')[0];
  return isArea(area) ? area : undefined;
}
