// Every area is declared here, as core or as a module. Nothing is core by
// default: a permission whose area is missing from this map does not compile.
export const AREAS = {
  students: 'core',
  finance: 'module',
  admissions: 'module',
} as const;

export type Area = keyof typeof AREAS;

export type ModuleKey = {
  [A in Area]: (typeof AREAS)[A] extends 'module' ? A : never;
}[Area];

export function isArea(value: string): value is Area {
  return Object.hasOwn(AREAS, value);
}
