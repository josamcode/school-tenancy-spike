import { Area, AREAS, ModuleKey } from './areas.js';

export type { ModuleKey };

// Must match the rows of the modules table. A test compares the two.
export const MODULES = (Object.keys(AREAS) as Area[]).filter(
  (area): area is ModuleKey => AREAS[area] === 'module',
);
