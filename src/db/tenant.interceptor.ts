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

// Wraps the handler in the tenant transaction for the school in the path.
@Injectable()
export class TenantInterceptor implements NestInterceptor {
  constructor(private readonly tenantDb: TenantDb) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
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
