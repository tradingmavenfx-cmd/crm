import {
  ExecutionContext,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { Request } from 'express';
import { Role } from '@prisma/client';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { AuthUser } from '../decorators/current-user.decorator';
import {
  ApiKeysService,
  scopeAllows,
} from '../../modules/developer/api-keys.service';

/** How a program presents its key. */
function presentedKey(request: Request): string | undefined {
  const header = request.headers['x-api-key'];
  if (typeof header === 'string' && header) return header;

  const auth = request.headers.authorization;
  // A key can also travel in the Authorization header, which is what most HTTP
  // clients make easy; its prefix tells it apart from a JWT.
  if (auth?.startsWith('Bearer crm_')) return auth.slice(7);
  return undefined;
}

/**
 * Surfaces a key may never touch, whatever scopes it holds.
 *
 * Signing in, and reading or erasing the workspace's own security data, are
 * things a person does with a session — not something a credential left in a
 * script should be able to reach.
 */
const OFF_LIMITS = new Set(['auth', 'security']);

/**
 * What this request needs permission for, worked out from the request itself.
 *
 * Deliberately mechanical — the first path segment is the resource, and
 * anything that is not a read is a write — so every route is covered without
 * each one having to remember to declare a scope. Coarse, and predictable
 * because of it.
 */
export function requiredScope(request: Request): {
  resource: string;
  scope: string;
} {
  const path = (request.path ?? request.url ?? '').replace(/^\/api\/?/, '');
  const resource = path.split('/').filter(Boolean)[0] ?? 'root';
  const action = ['GET', 'HEAD', 'OPTIONS'].includes(request.method)
    ? 'read'
    : 'write';
  return { resource, scope: `${resource}:${action}` };
}

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(
    private readonly reflector: Reflector,
    private readonly apiKeys: ApiKeysService,
  ) {
    super();
  }

  async canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const request = context
      .switchToHttp()
      .getRequest<
        Request & { user?: AuthUser; apiKey?: { id: string; scopes: string[] } }
      >();
    const key = presentedKey(request);
    if (!key) return super.canActivate(context) as Promise<boolean>;

    const identity = await this.apiKeys.authenticate(key, request.ip);

    if (
      !this.apiKeys.withinRateLimit(
        identity.apiKeyId,
        identity.rateLimitPerMinute,
      )
    ) {
      throw new HttpException(
        `This key is limited to ${identity.rateLimitPerMinute} requests a minute`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const { resource, scope } = requiredScope(request);
    if (OFF_LIMITS.has(resource)) {
      throw new ForbiddenException(`An API key cannot be used on /${resource}`);
    }
    if (!scopeAllows(identity.scopes, scope)) {
      throw new ForbiddenException(`This key does not have "${scope}"`);
    }

    // Shaped like a signed-in user so everything downstream — the tenant
    // scope, @CurrentUser, the role guard — works without knowing the
    // difference. There is no person behind a key, so there is no userId, and
    // what the key may do is decided by its scopes rather than by a role.
    request.user = {
      userId: '',
      tenantId: identity.tenantId,
      email: `api-key:${identity.apiKeyId}`,
      role: Role.TENANT_ADMIN,
    };
    request.apiKey = { id: identity.apiKeyId, scopes: identity.scopes };
    return true;
  }
}
