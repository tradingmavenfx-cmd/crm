/**
 * Proves the database — not the application — is what keeps workspaces apart.
 *
 * Run with: npx ts-node prisma/verify-rls.ts
 *
 * Every query here deliberately omits `tenantId`, which is exactly the mistake
 * row-level security exists to survive.
 */
import { PrismaClient } from '@prisma/client';
import { TenantContext } from '../src/prisma/tenant-context';

const base = new PrismaClient();

// The same extension the application uses, so this exercises the real path.
const prisma = base.$extends({
  query: {
    $allModels: {
      $allOperations: async ({ args, query }) => {
        const scope = TenantContext.current();
        if (!scope || scope.mode === 'system') {
          const [, result] = await base.$transaction([
            base.$executeRaw`SELECT set_config('app.bypass_rls', 'on', TRUE)`,
            query(args),
          ]);
          return result;
        }
        const [, result] = await base.$transaction([
          base.$executeRaw`SELECT set_config('app.tenant_id', ${scope.tenantId}, TRUE)`,
          query(args),
        ]);
        return result;
      },
    },
  },
});

const line = (label: string, value: unknown) =>
  // eslint-disable-next-line no-console
  console.log(`  ${label.padEnd(52)} ${String(value)}`);

async function main() {
  // ── Two workspaces, one of them made just for this ──
  const acme = await TenantContext.asSystem('setup', () =>
    prisma.tenant.findFirst({ where: { slug: 'acme' } }),
  );
  if (!acme) throw new Error('Seed the demo tenant first');

  const other = await TenantContext.asSystem('setup', async () => {
    const existing = await prisma.tenant.findFirst({ where: { slug: 'rls-probe' } });
    if (existing) return existing;
    return prisma.tenant.create({
      data: { name: 'RLS Probe Ltd', slug: 'rls-probe' },
    });
  });

  await TenantContext.asSystem('setup', async () => {
    const has = await prisma.contact.findFirst({
      where: { tenantId: other.id, email: 'probe@rls.test' },
    });
    if (!has) {
      await prisma.contact.create({
        data: {
          tenantId: other.id,
          firstName: 'Probe',
          lastName: 'Contact',
          email: 'probe@rls.test',
        },
      });
    }

    // A deal too, so "is the count scoped?" has something to be scoped away
    // from: comparing two equal numbers would prove nothing.
    const stage =
      (await prisma.dealStage.findFirst({ where: { tenantId: other.id } })) ??
      (await prisma.dealStage.create({
        data: { tenantId: other.id, name: 'Lead In', order: 0 },
      }));
    const deal = await prisma.deal.findFirst({
      where: { tenantId: other.id, title: 'Probe deal' },
    });
    if (!deal) {
      await prisma.deal.create({
        data: {
          tenantId: other.id,
          title: 'Probe deal',
          value: '1',
          stageId: stage.id,
        },
      });
    }
  });

  // eslint-disable-next-line no-console
  console.log('\nAs Acme, running queries that FORGOT their tenantId:\n');

  await TenantContext.asTenant(acme.id, async () => {
    const contacts = await prisma.contact.findMany();
    line('contacts visible', contacts.length);
    line(
      'any of them belong to the other workspace?',
      contacts.some((c) => c.tenantId === other.id) ? 'YES - LEAK' : 'no',
    );

    const probe = await prisma.contact.findFirst({
      where: { email: 'probe@rls.test' },
    });
    line("the other workspace's contact, fetched by email", probe ? 'FOUND - LEAK' : 'not found');

    const tenants = await prisma.tenant.findMany();
    line('workspaces visible', tenants.length);

    const counted = await prisma.deal.count();
    const all = await TenantContext.asSystem('probe', () => prisma.deal.count());
    line('deals counted as Acme', counted);
    line('deals that exist in total', all);
    line('count is scoped?', counted < all ? 'yes' : 'NO - LEAK');
  });

  // eslint-disable-next-line no-console
  console.log('\nWriting into another workspace, as Acme:\n');

  await TenantContext.asTenant(acme.id, async () => {
    try {
      await prisma.contact.create({
        data: {
          tenantId: other.id,
          firstName: 'Planted',
          lastName: 'Row',
        },
      });
      line('insert into the other workspace', 'SUCCEEDED - LEAK');
    } catch (err) {
      const message = (err as Error).message;
      const refused = /row-level security|violates row-level/i.test(message)
        ? 'refused by the row-level security policy'
        : 'refused';
      line('insert into the other workspace', refused);
    }

    const updated = await prisma.contact.updateMany({
      where: { email: 'probe@rls.test' },
      data: { firstName: 'Tampered' },
    });
    line("update of the other workspace's row", updated.count === 0 ? 'no rows' : 'CHANGED - LEAK');

    const deleted = await prisma.contact.deleteMany({
      where: { email: 'probe@rls.test' },
    });
    line("delete of the other workspace's row", deleted.count === 0 ? 'no rows' : 'DELETED - LEAK');
  });

  // ── And the other workspace is untouched ──
  const stillThere = await TenantContext.asSystem('probe', () =>
    prisma.contact.findFirst({ where: { email: 'probe@rls.test' } }),
  );
  // eslint-disable-next-line no-console
  console.log('');
  line('the other workspace still has its contact', stillThere ? `yes (${stillThere.firstName})` : 'NO - IT WAS TOUCHED');

  await base.$disconnect();
}

main().catch(async (err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  await base.$disconnect();
  process.exit(1);
});
