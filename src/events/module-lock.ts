import { sql } from 'drizzle-orm';

// The same key the tenant_modules trigger locks exclusively when a module is
// switched. Shared here, so handlers do not block each other.
export const lockModuleShared = (module: string) => sql`
  select pg_advisory_xact_lock_shared(hashtextextended(
    current_setting('app.tenant_id')::uuid::text || ':module:' || ${module}, 0))`;
