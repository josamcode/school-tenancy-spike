import { Controller, ForbiddenException, Get, Req } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { AuthenticatedRequest } from '../auth/auth.guard.js';
import { I18nText } from '../db/i18n-text.js';
import { TenantDb } from '../db/tenant-db.js';

interface School {
  id: string;
  name: string;
  nameI18n: I18nText | null;
  // An IANA name. Instants are returned in UTC and shown in this zone.
  timezone: string;
  // Null when the user is not a member and holds only grants there.
  role: string | null;
  grants: string[];
}

@Controller('me')
export class MeController {
  constructor(private readonly tenantDb: TenantDb) {}

  // The schools the caller can open, through a membership, a grant or both.
  // The route has no school in its path, so nothing here sets one: the two
  // queries see the caller's own rows and no row of any school.
  @Get('schools')
  async schools(@Req() request: AuthenticatedRequest): Promise<School[]> {
    const userId = request.userId;
    const access = await this.tenantDb.runForUser(userId, async () => {
      const db = this.tenantDb.db;
      const memberships = await db.execute<{ tenant_id: string; role: string }>(
        sql`select tenant_id, role from memberships where user_id = ${userId}`,
      );
      const grants = await db.execute<{
        tenant_id: string;
        permission: string;
      }>(
        sql`select tenant_id, permission from grants
             where user_id = ${userId} order by permission`,
      );
      return { memberships: memberships.rows, grants: grants.rows };
    });

    const ids = new Set(
      [...access.memberships, ...access.grants].map((row) => row.tenant_id),
    );
    const schools: School[] = [];
    for (const id of ids) {
      // A school's name and timezone are visible only with that school set,
      // so each one is read in a transaction of its own, which confirms the
      // access again.
      const named = await this.nameOf(userId, id);
      if (!named) continue;
      schools.push({
        id,
        ...named,
        role:
          access.memberships.find((row) => row.tenant_id === id)?.role ?? null,
        grants: access.grants
          .filter((row) => row.tenant_id === id)
          .map((row) => row.permission),
      });
    }
    return schools.sort((a, b) =>
      a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
    );
  }

  private async nameOf(
    userId: string,
    schoolId: string,
  ): Promise<Pick<School, 'name' | 'nameI18n' | 'timezone'> | undefined> {
    try {
      return await this.tenantDb.run(userId, schoolId, async () => {
        const { rows } = await this.tenantDb.db.execute<{
          name: string;
          name_i18n: I18nText | null;
          timezone: string;
        }>(sql`select name, name_i18n, timezone from tenants`);
        const [school] = rows;
        return {
          name: school.name,
          nameI18n: school.name_i18n,
          timezone: school.timezone,
        };
      });
    } catch (error) {
      // The access was removed between the two reads.
      if (error instanceof ForbiddenException) return undefined;
      throw error;
    }
  }
}
