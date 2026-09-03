import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { TenantContext } from './tenant-context';

/**
 * Prisma, with the workspace the caller is allowed to see declared on every
 * query.
 *
 * Postgres holds the isolation: each tenant-scoped table has a policy that
 * admits a row only when it belongs to the tenant named in `app.tenant_id`.
 * Because the pool hands out connections per query, the setting has to travel
 * with the query — so every operation runs as a two-statement transaction that
 * sets it first. That costs a round trip and buys the guarantee that a query
 * which forgot its tenantId returns nothing rather than everything.
 */
@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger('Prisma');

  constructor() {
    super();

    // Assigned over the client's own $extends result: the extension has to be
    // in place for every query the application makes, including the ones made
    // through injected `PrismaService`.
    return this.withTenantScope() as this;
  }

  private withTenantScope() {
    return this.$extends({
      query: {
        $allModels: {
          $allOperations: async ({ args, query }) => {
            const scope = TenantContext.current();

            // Outside a request — a scheduled sweep, the seed, a test — there
            // is nothing to scope to, and the work is cross-tenant by nature.
            if (!scope || scope.mode === 'system') {
              const [, result] = await this.$transaction([
                this
                  .$executeRaw`SELECT set_config('app.bypass_rls', 'on', TRUE)`,
                query(args),
              ]);
              return result;
            }

            // TRUE makes it local to this transaction, so the setting cannot
            // leak to the next caller that borrows the connection.
            const [, result] = await this.$transaction([
              this
                .$executeRaw`SELECT set_config('app.tenant_id', ${scope.tenantId}, TRUE)`,
              query(args),
            ]);
            return result;
          },
        },
      },
    });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
    await this.checkIsolationIsRealYet();
  }

  /**
   * Says so, loudly, when the policies are not actually in force.
   *
   * A superuser — and any role with BYPASSRLS — ignores row-level security
   * outright, so a connection made as one turns every policy in the schema
   * into decoration. That is exactly the kind of thing that is invisible until
   * it matters, so it is checked at startup rather than assumed.
   */
  private async checkIsolationIsRealYet(): Promise<void> {
    try {
      const [role] = await this.$queryRaw<
        { rolname: string; rolsuper: boolean; rolbypassrls: boolean }[]
      >`SELECT rolname, rolsuper, rolbypassrls
          FROM pg_roles WHERE rolname = current_user`;

      if (role?.rolsuper || role?.rolbypassrls) {
        this.logger.error(
          `Connected as "${role.rolname}", which bypasses row-level security. ` +
            'Workspaces are being kept apart by application code alone. ' +
            'Run "npm run db:setup-role" and point DATABASE_URL at that role.',
        );
        return;
      }

      this.logger.log(
        `Row-level security in force; connected as "${role?.rolname}"`,
      );
    } catch (err) {
      this.logger.warn(
        `Could not confirm row-level security is in force: ${
          err instanceof Error ? err.message : err
        }`,
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
