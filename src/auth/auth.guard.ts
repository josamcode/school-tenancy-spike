import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { jwtVerify } from 'jose';
import { isUuid } from '../common/uuid.js';
import { IS_PUBLIC } from './public.decorator.js';

export interface AuthenticatedRequest extends Request {
  userId: string;
}

@Injectable()
export class AuthGuard implements CanActivate {
  private readonly key: Uint8Array;

  constructor(private readonly reflector: Reflector) {
    const secret = process.env.JWT_SECRET;
    if (!secret) throw new Error('JWT_SECRET is not set');
    this.key = new TextEncoder().encode(secret);
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const [scheme, token] = (request.headers.authorization ?? '').split(' ');
    if (scheme !== 'Bearer' || !token) throw new UnauthorizedException();

    let subject: string | undefined;
    try {
      const { payload } = await jwtVerify(token, this.key, {
        algorithms: ['HS256'],
        requiredClaims: ['exp', 'sub'],
      });
      subject = payload.sub;
    } catch {
      throw new UnauthorizedException();
    }
    // The policies cast this value to uuid, so anything else must stop here.
    if (!isUuid(subject)) throw new UnauthorizedException();

    request.userId = subject;
    return true;
  }
}
