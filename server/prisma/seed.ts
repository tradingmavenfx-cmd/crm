import { PrismaClient, Role, ActivityType } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const slug = 'acme';

  // Idempotent: if the demo tenant already exists, leave its data untouched
  // (avoids wiping conversations/contacts on every container restart).
  const existing = await prisma.tenant.findUnique({ where: { slug } });
  if (existing) {
    // Core data is left untouched, but newer modules top themselves up so an
    // existing database still gets the IVR/SMS demo content.
    await seedTelephonyAndSms(existing.id);
    // eslint-disable-next-line no-console
    console.log('✅ Demo tenant already seeded — telephony/SMS demo data checked.');
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

  await seedTelephonyAndSms(tenant.id);

  // eslint-disable-next-line no-console
  console.log('✅ Seed complete.');
  // eslint-disable-next-line no-console
  console.log('   Tenant slug: acme');
  // eslint-disable-next-line no-console
  console.log('   Login: admin@acme.com / rep@acme.com  (password: Password123!)');
}

/**
 * IVR flows, agent numbers and SMS templates (Phase 2.2 / 2.4). Runs on both a
 * fresh and an already-seeded tenant, and does nothing if the data is present.
 */
async function seedTelephonyAndSms(tenantId: string): Promise<void> {
  // Agents need a reachable number for IVR transfers and click-to-call.
  const numbers: Record<string, string> = {
    'admin@acme.com': '+911140002001',
    'rep@acme.com': '+911140002002',
  };
  for (const [email, phone] of Object.entries(numbers)) {
    await prisma.user.updateMany({
      where: { tenantId, email, phone: null },
      data: { phone },
    });
  }

  const rep = await prisma.user.findFirst({
    where: { tenantId, email: 'rep@acme.com' },
  });

  const flowCount = await prisma.ivrFlow.count({ where: { tenantId } });
  if (flowCount === 0) {
    // Second level first, so the main menu can point at it.
    const support = await prisma.ivrFlow.create({
      data: {
        tenantId,
        name: 'Support Menu',
        description: 'Second-level menu reached from the main menu.',
        greeting: 'You have reached support.',
        options: [
          { digit: '1', label: 'voicemail', action: 'voicemail' },
          {
            digit: '2',
            label: 'support hours',
            action: 'message',
            value: 'Our support team is available Monday to Saturday, 9 AM to 7 PM India time.',
          },
        ],
      },
    });

    const main = await prisma.ivrFlow.create({
      data: {
        tenantId,
        name: 'Main Menu',
        description: 'Answers all inbound calls.',
        greeting: 'Welcome to Acme Corp.',
        isActive: true,
        options: [
          {
            digit: '1',
            label: 'sales',
            action: 'transfer',
            value: rep?.id ?? '',
          },
          { digit: '2', label: 'support', action: 'menu', value: support.id },
          {
            digit: '3',
            label: 'order status',
            action: 'crm_lookup',
            value: 'deal',
          },
          { digit: '9', label: 'voicemail', action: 'voicemail' },
        ],
      },
    });

    // Let callers step back up from the support menu.
    await prisma.ivrFlow.update({
      where: { id: support.id },
      data: {
        options: [
          ...(support.options as unknown as Record<string, string>[]),
          { digit: '0', label: 'main menu', action: 'menu', value: main.id },
        ],
      },
    });
  }

  const ruleCount = await prisma.assignmentRule.count({ where: { tenantId } });
  if (ruleCount === 0 && rep) {
    await prisma.assignmentRule.create({
      data: {
        tenantId,
        name: 'Billing questions to the rep',
        priority: 0,
        conditions: { keywords: ['invoice', 'refund', 'billing', 'payment'] },
        strategy: 'specific',
        assignToId: rep.id,
      },
    });
    await prisma.assignmentRule.create({
      data: {
        tenantId,
        name: 'Everything else, round robin',
        priority: 10,
        conditions: {},
        strategy: 'round_robin',
      },
    });
  }

  const sequenceCount = await prisma.sequence.count({ where: { tenantId } });
  if (sequenceCount === 0) {
    await prisma.sequence.create({
      data: {
        tenantId,
        name: 'New lead nurture',
        description: 'Three touches over a week, stops the moment they reply.',
        stopOnReply: true,
        steps: {
          create: [
            {
              order: 0,
              delayHours: 1,
              subject: 'Thanks for getting in touch, {{firstName}}',
              body: '<p>Hi {{firstName}}, thanks for your interest in Acme CRM. Happy to set up a quick demo.</p>',
            },
            {
              order: 1,
              delayHours: 48,
              subject: 'Anything I can help with?',
              body: '<p>Just checking in, {{firstName}} - any questions about pricing or GST invoicing?</p>',
            },
            {
              order: 2,
              delayHours: 120,
              subject: 'Closing the loop',
              body: '<p>No worries if the timing is off, {{firstName}}. I will leave this here for now.</p>',
            },
          ],
        },
      },
    });
  }

  const workflowCount = await prisma.workflow.count({ where: { tenantId } });
  if (workflowCount === 0) {
    await prisma.workflow.create({
      data: {
        tenantId,
        name: 'Escalate urgent messages',
        description:
          'Any inbound message mentioning urgent or complaint raises a high-priority callback task.',
        trigger: 'MESSAGE_RECEIVED',
        triggerConfig: {},
        conditions: {
          any: [
            { field: 'body', op: 'contains', value: 'urgent' },
            { field: 'body', op: 'contains', value: 'complaint' },
          ],
        },
        actions: [
          {
            type: 'create_task',
            config: {
              title: 'Escalation from {{externalId}}',
              description: 'Message: {{body}}',
              priority: 'high',
              dueInHours: 2,
            },
          },
        ],
      },
    });
  }

  const dashboardCount = await prisma.dashboard.count({ where: { tenantId } });
  if (dashboardCount === 0) {
    await prisma.dashboard.create({
      data: {
        tenantId,
        name: 'Sales overview',
        description: 'Pipeline, forecast and team performance at a glance.',
        isDefault: true,
        widgets: {
          create: [
            {
              tenantId,
              title: 'Pipeline by stage',
              reportKey: 'sales.pipeline',
              chart: 'funnel',
              position: 0,
              width: 'half',
            },
            {
              tenantId,
              title: 'Revenue forecast',
              reportKey: 'sales.forecast',
              chart: 'bar',
              position: 1,
              width: 'half',
            },
            {
              tenantId,
              title: 'Rep leaderboard',
              reportKey: 'sales.leaderboard',
              chart: 'bar',
              position: 2,
              width: 'full',
            },
            {
              tenantId,
              title: 'Omnichannel engagement',
              reportKey: 'comms.omnichannel',
              chart: 'line',
              params: { days: 14 },
              position: 3,
              width: 'full',
            },
          ],
        },
      },
    });
  }

  const productCount = await prisma.product.count({ where: { tenantId } });
  if (productCount === 0) {
    const catalogue = [
      {
        sku: 'CRM-PRO',
        name: 'CRM Pro licence (per user / year)',
        unitPrice: 12000,
        taxRate: 18,
        hsnCode: '997331',
      },
      {
        sku: 'CRM-ENT',
        name: 'CRM Enterprise licence (per user / year)',
        unitPrice: 24000,
        taxRate: 18,
        hsnCode: '997331',
      },
      {
        sku: 'ONBOARD',
        name: 'Onboarding & data migration',
        unitPrice: 75000,
        taxRate: 18,
        hsnCode: '998313',
      },
      {
        sku: 'WA-CREDITS',
        name: 'WhatsApp conversation credits (1000)',
        unitPrice: 3500,
        taxRate: 18,
        hsnCode: '998414',
      },
    ];

    const created = [];
    for (const item of catalogue) {
      created.push(
        await prisma.product.create({ data: { tenantId, ...item } }),
      );
    }

    // A standard book at list price, and an enterprise book at a better rate.
    const standard = await prisma.priceBook.create({
      data: { tenantId, name: 'Standard (INR)', isDefault: true },
    });
    const enterprise = await prisma.priceBook.create({
      data: { tenantId, name: 'Enterprise (INR)' },
    });

    for (const product of created) {
      await prisma.priceBookEntry.create({
        data: {
          tenantId,
          priceBookId: standard.id,
          productId: product.id,
          unitPrice: product.unitPrice,
        },
      });
      await prisma.priceBookEntry.create({
        data: {
          tenantId,
          priceBookId: enterprise.id,
          productId: product.id,
          // 15% off list for enterprise customers
          unitPrice: Number(product.unitPrice) * 0.85,
        },
      });
    }
  }

  const discountRuleCount = await prisma.discountRule.count({
    where: { tenantId },
  });
  if (discountRuleCount === 0) {
    await prisma.discountRule.create({
      data: {
        tenantId,
        name: 'Reps may discount up to 10%',
        priority: 0,
        appliesToRoles: [Role.SALES_REP],
        maxDiscountPercent: 10,
        approverRole: Role.MANAGER,
      },
    });
    await prisma.discountRule.create({
      data: {
        tenantId,
        name: 'Managers may discount up to 25%',
        priority: 10,
        appliesToRoles: [Role.MANAGER],
        maxDiscountPercent: 25,
        approverRole: Role.TENANT_ADMIN,
      },
    });
  }

  const slaCount = await prisma.slaPolicy.count({ where: { tenantId } });
  if (slaCount === 0) {
    await prisma.slaPolicy.create({
      data: {
        tenantId,
        name: 'Standard support',
        isDefault: true,
        // Minutes to first response, by priority
        firstResponseMinutes: { LOW: 480, MEDIUM: 240, HIGH: 60, URGENT: 30 },
        // Minutes to resolution
        resolutionMinutes: { LOW: 5760, MEDIUM: 2880, HIGH: 480, URGENT: 240 },
      },
    });
  }

  const ticketRuleCount = await prisma.ticketRule.count({ where: { tenantId } });
  if (ticketRuleCount === 0 && rep) {
    await prisma.ticketRule.create({
      data: {
        tenantId,
        name: 'Billing questions',
        priority: 0,
        conditions: { keywords: ['invoice', 'refund', 'billing', 'payment'] },
        setCategory: 'Billing',
        setPriority: 'HIGH',
        strategy: 'specific',
        assignToId: rep.id,
      },
    });
    await prisma.ticketRule.create({
      data: {
        tenantId,
        name: 'Outages are urgent',
        priority: 5,
        conditions: { keywords: ['down', 'outage', 'not working', 'broken'] },
        setCategory: 'Incident',
        setPriority: 'URGENT',
        strategy: 'load_based',
      },
    });
    await prisma.ticketRule.create({
      data: {
        tenantId,
        name: 'Everything else, least busy agent',
        priority: 100,
        conditions: {},
        setCategory: 'General',
        strategy: 'load_based',
      },
    });
  }

  const articleCount = await prisma.article.count({ where: { tenantId } });
  if (articleCount === 0) {
    const billing = await prisma.articleCategory.create({
      data: {
        tenantId,
        name: 'Billing',
        slug: 'billing',
        description: 'Invoices, payments and refunds',
        position: 0,
      },
    });
    const gettingStarted = await prisma.articleCategory.create({
      data: {
        tenantId,
        name: 'Getting started',
        slug: 'getting-started',
        position: 1,
      },
    });

    const publish = async (data: {
      slug: string;
      title: string;
      excerpt: string;
      body: string;
      categoryId: string;
      tags: string[];
      visibility?: 'PUBLIC' | 'INTERNAL';
      locale?: string;
      translationOfId?: string;
    }) => {
      const article = await prisma.article.create({
        data: {
          tenantId,
          status: 'PUBLISHED',
          publishedAt: new Date(),
          visibility: data.visibility ?? 'PUBLIC',
          locale: data.locale ?? 'en',
          ...data,
        },
      });
      // Publishing snapshots version 1, the same as the API does.
      await prisma.articleVersion.create({
        data: {
          tenantId,
          articleId: article.id,
          version: 1,
          title: article.title,
          body: article.body,
          note: 'Initial version',
        },
      });
      return article;
    };

    const refunds = await publish({
      slug: 'refund-policy',
      title: 'Refund policy',
      excerpt: 'How refunds work and how long they take.',
      body: 'Refunds are processed within 7 working days of approval. The amount returns to the original payment method. For UPI payments the bank may take a further 2-3 days to show the credit.',
      categoryId: billing.id,
      tags: ['refund', 'payment', 'billing'],
    });

    await publish({
      slug: 'refund-policy-hi',
      title: 'Refund niti',
      excerpt: 'Refund kaise hota hai aur kitna samay lagta hai.',
      body: 'Approval ke 7 kaam ke din ke andar refund process ho jaata hai. Paisa usi payment method mein wapas aata hai.',
      categoryId: billing.id,
      tags: ['refund', 'billing'],
      locale: 'hi',
      translationOfId: refunds.id,
    });

    await publish({
      slug: 'gst-invoices',
      title: 'GST invoices and HSN codes',
      excerpt: 'Where to find your GST invoice and what the HSN code means.',
      body: 'Every invoice carries the HSN or SAC code for each line, along with the GST rate applied. You can add your GSTIN when a quote is converted to an invoice.',
      categoryId: billing.id,
      tags: ['gst', 'invoice', 'tax'],
    });

    await publish({
      slug: 'connecting-whatsapp',
      title: 'Connecting your WhatsApp number',
      excerpt: 'Set up the WhatsApp Business API in a few minutes.',
      body: 'Add WHATSAPP_ACCESS_TOKEN and WHATSAPP_PHONE_NUMBER_ID to your environment, then point the Meta webhook at your workspace. Until then messages are logged by the mock provider.',
      categoryId: gettingStarted.id,
      tags: ['whatsapp', 'setup', 'channels'],
    });

    await publish({
      slug: 'refund-approval-runbook',
      title: 'Runbook: approving a refund',
      excerpt: 'Internal steps before promising a refund date.',
      body: 'Check the invoice status, confirm with finance that the payment settled, then raise the credit note. Never promise a date before finance confirms.',
      categoryId: billing.id,
      tags: ['refund', 'runbook'],
      visibility: 'INTERNAL',
    });
  }

  const templateCount = await prisma.smsTemplate.count({ where: { tenantId } });
  if (templateCount === 0) {
    await prisma.smsTemplate.createMany({
      data: [
        {
          tenantId,
          name: 'Callback promise',
          body: 'Hi {{name}}, sorry we missed your call. {{agent}} will call you back within {{minutes}} minutes.',
        },
        {
          tenantId,
          name: 'Payment reminder',
          body: 'Hi {{name}}, invoice {{invoice}} of Rs {{amount}} is due on {{date}}. Pay via {{link}}. Reply STOP to opt out.',
        },
        {
          tenantId,
          name: 'Demo confirmation',
          body: 'Your demo with Acme Corp is confirmed for {{date}} at {{time}}. Reply STOP to opt out.',
        },
      ],
    });
  }
}

main()
  .catch((e) => {
    // eslint-disable-next-line no-console
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
