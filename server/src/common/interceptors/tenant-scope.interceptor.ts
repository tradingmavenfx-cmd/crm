import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { Observable } from 'rxjs';
import { DbScope } from '../../prisma/tenant-context';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { AuthUser } from '../decorators/current-user.decorator';
import { TenantContext } from '../../prisma/tenant-context';

/**
 * Declares, for the length of one request, which workspace the database is
 * allowed to answer for.
 *
 * A signed-in request is pinned to the tenant in its token, and Postgres
 * refuses anything else — a service method that forgets its `tenantId` now
 * returns nothing instead of everything.
 *
 * A public route steps outside that, because it has no token to read a tenant
 * from: it is addressed by an unguessable token, or carries the tenant in the
 * path, and does its own scoping. Those are the routes to read carefully.
 */
@Injectable()
export class TenantScopeInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();

    const request = context
      .switchToHttp()
      .getRequest<Request & { user?: AuthUser }>();

    const tenantId = request.user?.tenantId;
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    const scope: DbScope = tenantId
      ? { mode: 'tenant', tenantId }
      : {
          mode: 'system',
          reason: isPublic ? 'public route' : 'unauthenticated request',
        };

    // Subscribed inside the context, not merely created inside it: an
    // Observable does nothing until something subscribes, and the handler runs
    // at that moment. Returning `next.handle()` from the context would leave
    // the controller to run outside it, scoped to nothing.
    return new Observable((subscriber) =>
      TenantContext.scoped(scope, () => next.handle().subscribe(subscriber)),
    );
  }
}
