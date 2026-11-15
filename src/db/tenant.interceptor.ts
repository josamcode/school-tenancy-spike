import {
  BadRequestException,
  CallHandler,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { and, eq } from 'drizzle-orm';
import { from, lastValueFrom, Observable } from 'rxjs';
import type { AuthenticatedRequest } from '../auth/auth.guard.js';
import { isUuid } from '../common/uuid.js';
import { tenantModules } from '../core/core.schema.js';
import {
  declarationOf,
  declarationProblem,
} from '../entitlements/decorators.js';
import type { ModuleKey } from '../entitlements/modules.js';
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

    const declaration = declarationOf(
      this.reflector,
      context.getHandler(),
      context.getClass(),
    );
    // The app refuses to start with such a route. This is the second line of defence.
    const problem = declarationProblem(true, declaration);
    if (problem)
      throw new Error(`${request.method} ${request.path} ${problem}`);

    const schoolId = request.params.schoolId;
    // Interceptors run before pipes, so the format is checked here, before any query.
    if (!isUuid(schoolId)) throw new BadRequestException('Invalid school id');

    // The module check runs inside the transaction, so only after the
    // membership is confirmed. A non-member never learns what a school has.
    return from(
      this.tenantDb.run(request.userId, schoolId, async () => {
        if (declaration.module) await this.requireModule(declaration.module);
        return lastValueFrom(next.handle());
      }),
    );
  }

  // Read on every request, so a change takes effect on the next one.
  private async requireModule(module: ModuleKey): Promise<void> {
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
}
