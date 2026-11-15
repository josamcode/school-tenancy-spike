// Must match the rows of the modules table. A test compares the two.
export const MODULES = ['finance'] as const;

export type ModuleKey = (typeof MODULES)[number];
