import { sql } from 'drizzle-orm';

// After a transaction ends the setting reads as '', not NULL.
export const currentTenant = sql`NULLIF(current_setting('app.tenant_id', true), '')::uuid`;
