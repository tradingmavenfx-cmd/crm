import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';
import { PortalService } from './portal.service';

/**
 * Guards the customer portal.
 *
 * A portal session is not a CRM login: it carries its own opaque token and
 * resolves to a contact, never to a user with a role. Routes using it are
 * marked @Public() so the staff JWT guard stands aside, and this takes over.
 */
@Injectable()
export class PortalGuard implements CanActivate {
  constructor(private readonly portal: PortalService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const header = req.headers.authorization;
    const token = header?.startsWith('Bearer ')
      ? header.slice(7).trim()
      : undefined;

    if (!token) throw new UnauthorizedException('Not signed in');

    // Attached to the request, never read from the body or the path: the
    // session is the only thing that says whose data this is.
    (req as Request & { portal?: unknown }).portal =
      await this.portal.authenticate(token);
    (req as Request & { portalToken?: string }).portalToken = token;
    return true;
  }
}
