import { TenantContext } from './tenant-context';

/**
 * A stand-in for a Prisma call: it does nothing until it is awaited, and when
 * it is, it reports the scope in force at that moment — which is the thing
 * that actually decides what the database will answer.
 */
const lazyQuery = (): Promise<string> =>
  ({
    then(resolve: (mode: string) => void) {
      resolve(TenantContext.current()?.mode ?? 'none');
    },
  }) as unknown as Promise<string>;

describe('TenantContext', () => {
  it('has no scope until something says', () => {
    expect(TenantContext.current()).toBeUndefined();
  });

  it('pins a scope for the whole of an async call', async () => {
    await TenantContext.asTenant('t1', async () => {
      expect(TenantContext.current()).toEqual({
        mode: 'tenant',
        tenantId: 't1',
      });
      await new Promise((r) => setTimeout(r, 1));
      // Still there after an await: the frame follows the continuation.
      expect(TenantContext.current()).toEqual({
        mode: 'tenant',
        tenantId: 't1',
      });
    });
  });

  it('lets go of the scope afterwards', async () => {
    await TenantContext.asTenant('t1', async () => undefined);
    expect(TenantContext.current()).toBeUndefined();
  });

  it('awaits a lazy query inside the scope, not outside it', async () => {
    // The bug this exists for: handing a lazy promise back out of the context
    // left it to run under whatever scope was in force at the await, so a
    // nested asSystem silently kept the outer tenant's scope.
    const mode = await TenantContext.asTenant('t1', () => lazyQuery());
    expect(mode).toBe('tenant');
  });

  it('a nested system scope really is a system scope', async () => {
    await TenantContext.asTenant('t1', async () => {
      const inner = await TenantContext.asSystem('sweep', () => lazyQuery());
      expect(inner).toBe('system');
      // And the outer scope comes back afterwards.
      expect(TenantContext.current()).toMatchObject({ mode: 'tenant' });
    });
  });

  it('a nested tenant scope wins over the one outside it', async () => {
    await TenantContext.asSystem('sweep', async () => {
      await TenantContext.asTenant('t2', async () => {
        expect(TenantContext.current()).toEqual({
          mode: 'tenant',
          tenantId: 't2',
        });
      });
      expect(TenantContext.current()).toMatchObject({ mode: 'system' });
    });
  });

  it('keeps two concurrent scopes apart', async () => {
    const [a, b] = await Promise.all([
      TenantContext.asTenant('tenant-a', async () => {
        await new Promise((r) => setTimeout(r, 5));
        return TenantContext.current();
      }),
      TenantContext.asTenant('tenant-b', async () => {
        return TenantContext.current();
      }),
    ]);

    expect(a).toEqual({ mode: 'tenant', tenantId: 'tenant-a' });
    expect(b).toEqual({ mode: 'tenant', tenantId: 'tenant-b' });
  });

  it('records why a system scope was taken', async () => {
    await TenantContext.asSystem('nightly sweep', async () => {
      expect(TenantContext.current()).toEqual({
        mode: 'system',
        reason: 'nightly sweep',
      });
    });
  });
});
