import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate as applyMigrations } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';

export async function migrate(ownerUrl: string): Promise<void> {
  const pool = new pg.Pool({ connectionString: ownerUrl, max: 1 });
  try {
    await applyMigrations(drizzle(pool), {
      migrationsFolder: fileURLToPath(new URL('./migrations', import.meta.url)),
    });
  } finally {
    await pool.end();
  }
}

if (import.meta.main) {
  const ownerUrl = process.env.MIGRATION_DATABASE_URL;
  if (!ownerUrl) throw new Error('MIGRATION_DATABASE_URL is not set');
  await migrate(ownerUrl);
}
