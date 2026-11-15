import {
  BadRequestException,
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { from, lastValueFrom, Observable } from 'rxjs';
import type { AuthenticatedRequest } from '../auth/auth.guard.js';
import { isUuid } from '../common/uuid.js';
import { TenantDb } from './tenant-db.js';

// Global: wraps every route that has a schoolId path parameter in the tenant
// transaction for that school. Other routes pass through with no transaction.
@Injectable()
export class TenantInterceptor implements NestInterceptor {
  constructor(private readonly tenantDb: TenantDb) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!('schoolId' in request.params)) return next.handle();

    const schoolId = request.params.schoolId;
    // Interceptors run before pipes, so the format is checked here, before any query.
    if (!isUuid(schoolId)) throw new BadRequestException('Invalid school id');

    return from(
      this.tenantDb.run(request.userId, schoolId, () =>
        lastValueFrom(next.handle()),
      ),
    );
  }
}
