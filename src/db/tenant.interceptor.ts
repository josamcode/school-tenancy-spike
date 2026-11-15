import {
  BadRequestException,
  CallHandler,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { and, eq, sql } from 'drizzle-orm';
import { from, lastValueFrom, Observable } from 'rxjs';
import type { AuthenticatedRequest } from '../auth/auth.guard.js';
import { isUuid } from '../common/uuid.js';
import { tenantModules } from '../core/core.schema.js';
import { AREAS } from '../entitlements/areas.js';
import {
  declarationProblem,
  declaredPermission,
} from '../entitlements/decorators.js';
import { areaOf, Permission } from '../entitlements/permissions.js';
import { TenantDb } from './tenant-db.js';

// Global: wraps every route that has a schoolId path parameter in the tenant
// transaction for that school. Other routes pass through with no transaction.
@Injectable()
export class TenantInterceptor implements NestInterceptor {
  constructor(
    private readonly tenantDb: TenantDb,
    private readonly reflector: Reflector,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!('schoolId' in request.params)) return next.handle();

    const declared = declaredPermission(
      this.reflector,
      context.getHandler(),
      context.getClass(),
    );
    // The app refuses to start with such a route. This is the second line of defence.
    const problem = declarationProblem(true, declared);
    if (problem) {
      throw new Error(`${request.method} ${request.path} ${problem}`);
    }
    const permission = declared as Permission;

    const schoolId = request.params.schoolId;
    // Interceptors run before pipes, so the format is checked here, before any query.
    if (!isUuid(schoolId)) throw new BadRequestException('Invalid school id');

    // Both checks run inside the transaction, so only after the user's access
    // to the school is confirmed. Someone with no access never learns what a
    // school has. The module is checked before the permission.
    return from(
      this.tenantDb.run(request.userId, schoolId, async () => {
        const area = areaOf(permission)!;
        if (AREAS[area] === 'module') await this.requireModule(area);
        await this.requirePermission(request.userId, schoolId, permission);
        return lastValueFrom(next.handle());
      }),
    );
  }

  // Both are read on every request, so a change takes effect on the next one.
  private async requireModule(module: string): Promise<void> {
    const rows = await this.tenantDb.db
      .select({ module: tenantModules.module })
      .from(tenantModules)
      .where(
        and(eq(tenantModules.module, module), eq(tenantModules.enabled, true)),
      );
    if (rows.length === 0) {
      throw new ForbiddenException({
        statusCode: 403,
        code: 'MODULE_DISABLED',
        message: 'Module disabled',
      });
    }
  }

  // Held through the membership's role in this school, or through a grant in
  // this school. The school is part of both conditions on purpose: a role in
  // one school gives nothing in another.
  private async requirePermission(
    userId: string,
    schoolId: string,
    permission: Permission,
  ): Promise<void> {
    const held = await this.tenantDb.db.execute(sql`
      select 1
        from memberships m
        join role_permissions rp on rp.role = m.role
       where m.user_id = ${userId}
         and m.tenant_id = ${schoolId}
         and rp.permission = ${permission}
      union all
      select 1
        from grants g
       where g.user_id = ${userId}
         and g.tenant_id = ${schoolId}
         and g.permission = ${permission}
      limit 1
    `);
    if (held.rows.length === 0) {
      throw new ForbiddenException({
        statusCode: 403,
        code: 'PERMISSION_DENIED',
        message: 'Permission denied',
      });
    }
  }
}
