import { AsyncLocalStorage } from 'async_hooks';

/**
 * How the current unit of work is allowed to see the database.
 *
 * `tenant` pins every query to one workspace; the database refuses anything
 * else. `system` steps outside that, for the work that is genuinely
 * cross-tenant: signing in before the workspace is known, a token-addressed
 * public page, a scheduled sweep across every tenant, and the seed.
 */
export type DbScope =
  { mode: 'tenant'; tenantId: string } | { mode: 'system'; reason: string };

const storage = new AsyncLocalStorage<DbScope>();

export const TenantContext = {
  /** What the current call is scoped to, if anything has said. */
  current(): DbScope | undefined {
    return storage.getStore();
  },

  /**
   * Runs `fn` with every query pinned to one workspace.
   *
   * The callback is awaited *inside* the context on purpose. A Prisma call
   * returns a lazy promise that does no work until it is awaited, so handing
   * one back out of the context would leave it to run under whatever scope
   * happened to be in force at the await — which is how a nested `asSystem`
   * silently kept the outer tenant's scope.
   */
  async asTenant<T>(tenantId: string, fn: () => T | Promise<T>): Promise<T> {
    return storage.run({ mode: 'tenant', tenantId }, async () => fn());
  },

  /**
   * Runs `fn` without the tenant restriction.
   *
   * Every use needs a reason, because every use is a place where the database
   * is no longer the thing keeping workspaces apart — the code is. Grep for
   * this to find them all.
   */
  async asSystem<T>(reason: string, fn: () => T | Promise<T>): Promise<T> {
    return storage.run({ mode: 'system', reason }, async () => fn());
  },

  /**
   * Runs `fn` in a scope and returns whatever it returns, unwrapped.
   *
   * For callers that are not promise-shaped — an interceptor handing back an
   * Observable — and which therefore have to take care that the work really
   * starts inside the context.
   */
  scoped<T>(scope: DbScope, fn: () => T): T {
    return storage.run(scope, fn);
  },
};
