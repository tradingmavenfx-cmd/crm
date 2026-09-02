import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Request } from 'express';
import { PortalContext } from './portal.service';

/** The signed-in contact, put on the request by PortalGuard. */
export const Portal = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): PortalContext =>
    ctx.switchToHttp().getRequest<Request & { portal: PortalContext }>().portal,
);

/** The raw session token, for signing out. */
export const PortalToken = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string =>
    ctx.switchToHttp().getRequest<Request & { portalToken: string }>()
      .portalToken,
);
