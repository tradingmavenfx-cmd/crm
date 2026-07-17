import { PrismaClient, Role, ActivityType } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const slug = 'acme';

  // Idempotent: if the demo tenant already exists, leave its data untouched
  // (avoids wiping conversations/contacts on every container restart).
  const existing = await prisma.tenant.findUnique({ where: { slug } });
  if (existing) {
    // eslint-disable-next-line no-console
    console.log('✅ Demo tenant already seeded — skipping.');
    return;
  }

  const tenant = await prisma.tenant.create({
    data: { name: 'Acme Corp', slug, plan: 'enterprise' },
  });

  const passwordHash = await bcrypt.hash('Password123!', 10);

  const admin = await prisma.user.create({
    data: {
      tenantId: tenant.id,
      email: 'admin@acme.com',
      passwordHash,
      firstName: 'Ada',
      lastName: 'Admin',
      role: Role.TENANT_ADMIN,
    },
  });

  const rep = await prisma.user.create({
    data: {
      tenantId: tenant.id,
      email: 'rep@acme.com',
      passwordHash,
      firstName: 'Ravi',
      lastName: 'Rep',
      role: Role.SALES_REP,
    },
  });

  // Default pipeline stages
  const stageData = [
    { name: 'Lead In', order: 0, probability: 10 },
    { name: 'Qualified', order: 1, probability: 25 },
    { name: 'Proposal', order: 2, probability: 50 },
    { name: 'Negotiation', order: 3, probability: 75 },
    { name: 'Closed Won', order: 4, probability: 100 },
  ];
  const stages = [];
  for (const s of stageData) {
    stages.push(
      await prisma.dealStage.create({ data: { tenantId: tenant.id, ...s } }),
    );
  }

  const company = await prisma.company.create({
    data: {
      tenantId: tenant.id,
      name: 'Globex India Pvt Ltd',
      domain: 'globex.in',
      industry: 'Manufacturing',
      employees: 250,
      ownerId: rep.id,
    },
  });

  const contact = await prisma.contact.create({
    data: {
      tenantId: tenant.id,
      firstName: 'Priya',
      lastName: 'Sharma',
      email: 'priya@globex.in',
      phone: '+91-9876543210',
      jobTitle: 'Procurement Head',
      companyId: company.id,
      ownerId: rep.id,
      score: 65,
    },
  });

  const deal = await prisma.deal.create({
    data: {
      tenantId: tenant.id,
      title: 'Globex - Annual CRM License',
      value: '1500000',
      currency: 'INR',
      stageId: stages[1].id,
      companyId: company.id,
      contactId: contact.id,
      ownerId: rep.id,
    },
  });

  await prisma.activity.create({
    data: {
      tenantId: tenant.id,
      userId: rep.id,
      type: ActivityType.CALL,
      subject: 'Intro call with Priya',
      body: 'Discussed requirements for 250 seats.',
      contactId: contact.id,
      dealId: deal.id,
    },
  });

  await prisma.task.create({
    data: {
      tenantId: tenant.id,
      creatorId: admin.id,
      assigneeId: rep.id,
      title: 'Send proposal to Globex',
      priority: 'high',
      dueAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
    },
  });

  // eslint-disable-next-line no-console
  console.log('✅ Seed complete.');
  // eslint-disable-next-line no-console
  console.log('   Tenant slug: acme');
  // eslint-disable-next-line no-console
  console.log('   Login: admin@acme.com / rep@acme.com  (password: Password123!)');
}

main()
  .catch((e) => {
    // eslint-disable-next-line no-console
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
