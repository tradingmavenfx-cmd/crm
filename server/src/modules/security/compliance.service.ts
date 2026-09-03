import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from './audit.service';
import { ErasureDto } from './dto/security.dto';

/** What an erasure did, so it can be shown and kept. */
export interface ErasureReport {
  email: string;
  contacts: number;
  leads: number;
  messages: number;
  formSubmissions: number;
  ticketComments: number;
  portalSessions: number;
  documentsSigned: number;
}

const ERASED = '[erased]';

@Injectable()
export class ComplianceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Everything the tenant owns, as one JSON document.
   *
   * Secrets are left out on the way, not filtered on the way in: an export is
   * handed to whoever asked for it, and password hashes, refresh tokens and
   * share tokens have no business travelling with it.
   */
  async exportTenant(tenantId: string, userId?: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { id: true, name: true, slug: true, plan: true, createdAt: true },
    });
    if (!tenant) throw new NotFoundException('Workspace not found');

    const [
      users,
      contacts,
      companies,
      deals,
      leads,
      activities,
      tasks,
      conversations,
      messages,
      quotes,
      invoices,
      tickets,
      articles,
      documents,
    ] = await Promise.all([
      this.prisma.user.findMany({
        where: { tenantId },
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          role: true,
          isActive: true,
          createdAt: true,
        },
      }),
      this.prisma.contact.findMany({ where: { tenantId } }),
      this.prisma.company.findMany({ where: { tenantId } }),
      this.prisma.deal.findMany({ where: { tenantId } }),
      this.prisma.lead.findMany({ where: { tenantId } }),
      this.prisma.activity.findMany({ where: { tenantId } }),
      this.prisma.task.findMany({ where: { tenantId } }),
      this.prisma.conversation.findMany({ where: { tenantId } }),
      this.prisma.message.findMany({ where: { tenantId } }),
      this.prisma.quote.findMany({ where: { tenantId } }),
      this.prisma.invoice.findMany({ where: { tenantId } }),
      this.prisma.ticket.findMany({ where: { tenantId } }),
      this.prisma.article.findMany({ where: { tenantId } }),
      this.prisma.document.findMany({ where: { tenantId } }),
    ]);

    // Tokens address customer-facing pages: they are credentials, not data
    // about the record, and have no business travelling in an export. The
    // storage key is an internal detail that is useless without the bytes.
    const without = <T, K extends keyof T>(rows: T[], ...fields: K[]) =>
      rows.map((row) => {
        const copy = { ...row };
        for (const field of fields) delete copy[field];
        return copy as Omit<T, K>;
      });

    // Taking a copy of everything is exactly the action an audit trail is
    // for, so it records who did it rather than "the system".
    await this.audit.record({
      tenantId,
      userId,
      action: 'exported',
      entityType: 'tenant',
      entityId: tenantId,
      metadata: { contacts: contacts.length, deals: deals.length },
    });

    return {
      exportedAt: new Date().toISOString(),
      tenant,
      counts: {
        users: users.length,
        contacts: contacts.length,
        companies: companies.length,
        deals: deals.length,
        leads: leads.length,
        activities: activities.length,
        tasks: tasks.length,
        conversations: conversations.length,
        messages: messages.length,
        quotes: quotes.length,
        invoices: invoices.length,
        tickets: tickets.length,
        articles: articles.length,
        documents: documents.length,
      },
      users,
      contacts,
      companies,
      deals,
      leads,
      activities,
      tasks,
      conversations,
      messages,
      quotes: without(quotes, 'publicToken'),
      invoices,
      tickets: without(tickets, 'csatToken'),
      articles,
      documents: without(documents, 'storageKey'),
    };
  }

  /** Everything held about one person, for a subject access request. */
  async exportPerson(tenantId: string, email: string) {
    const address = email.trim().toLowerCase();

    const [contacts, leads, submissions, messages] = await Promise.all([
      this.prisma.contact.findMany({
        where: { tenantId, email: { equals: address, mode: 'insensitive' } },
        include: {
          activities: true,
          deals: {
            select: { id: true, title: true, value: true, status: true },
          },
          tickets: {
            select: { id: true, number: true, subject: true, status: true },
          },
        },
      }),
      this.prisma.lead.findMany({
        where: { tenantId, email: { equals: address, mode: 'insensitive' } },
        include: { touchpoints: true },
      }),
      this.prisma.formSubmission.findMany({
        where: {
          tenantId,
          lead: { email: { equals: address, mode: 'insensitive' } },
        },
      }),
      this.prisma.message.findMany({
        where: {
          tenantId,
          conversation: {
            contact: { email: { equals: address, mode: 'insensitive' } },
          },
        },
      }),
    ]);

    if (!contacts.length && !leads.length) {
      throw new NotFoundException('Nobody with that address is on file');
    }

    return {
      exportedAt: new Date().toISOString(),
      email: address,
      contacts,
      leads,
      formSubmissions: submissions,
      messages,
    };
  }

  /**
   * Erases a person, in the sense the GDPR means.
   *
   * Their details are overwritten rather than the rows deleted. A contact is
   * attached to deals, invoices and tickets that a business is required to
   * keep, and deleting the row would take those with it — so what identifies
   * the person goes, and the commercial record stays.
   */
  async erasePerson(
    tenantId: string,
    userId: string,
    dto: ErasureDto,
  ): Promise<ErasureReport> {
    const address = dto.email.trim().toLowerCase();
    if (!dto.confirm) {
      throw new BadRequestException(
        'Erasure cannot be undone; send confirm: true to proceed',
      );
    }

    const contacts = await this.prisma.contact.findMany({
      where: { tenantId, email: { equals: address, mode: 'insensitive' } },
      select: { id: true },
    });
    const leads = await this.prisma.lead.findMany({
      where: { tenantId, email: { equals: address, mode: 'insensitive' } },
      select: { id: true },
    });

    if (!contacts.length && !leads.length) {
      throw new NotFoundException('Nobody with that address is on file');
    }

    const contactIds = contacts.map((c) => c.id);
    const leadIds = leads.map((l) => l.id);

    const report: ErasureReport = {
      email: address,
      contacts: 0,
      leads: 0,
      messages: 0,
      formSubmissions: 0,
      ticketComments: 0,
      portalSessions: 0,
      documentsSigned: 0,
    };

    if (contactIds.length) {
      const { count } = await this.prisma.contact.updateMany({
        where: { id: { in: contactIds } },
        data: {
          firstName: ERASED,
          lastName: ERASED,
          email: null,
          phone: null,
          jobTitle: null,
        },
      });
      report.contacts = count;

      // The bodies are what carry the personal detail; the thread is kept so
      // the ticket and deal history still makes sense.
      const messages = await this.prisma.message.updateMany({
        where: { tenantId, conversation: { contactId: { in: contactIds } } },
        data: { body: ERASED },
      });
      report.messages = messages.count;

      const sessions = await this.prisma.portalSession.updateMany({
        where: { tenantId, contactId: { in: contactIds }, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      report.portalSessions = sessions.count;
    }

    if (leadIds.length) {
      const { count } = await this.prisma.lead.updateMany({
        where: { id: { in: leadIds } },
        data: {
          firstName: ERASED,
          lastName: null,
          email: null,
          phone: null,
          jobTitle: null,
          fields: {},
        },
      });
      report.leads = count;

      const submissions = await this.prisma.formSubmission.updateMany({
        where: { tenantId, leadId: { in: leadIds } },
        data: { data: {}, utm: {} },
      });
      report.formSubmissions = submissions.count;
    }

    // A signature carries a name and an IP address.
    const signed = await this.prisma.documentShare.updateMany({
      where: {
        tenantId,
        signedEmail: { equals: address, mode: 'insensitive' },
      },
      data: { signedName: ERASED, signedEmail: null, signedIp: null },
    });
    report.documentsSigned = signed.count;

    // The erasure itself is recorded, without the address: a trail proving a
    // request was honoured must not be the one place the address survives.
    await this.audit.record({
      tenantId,
      userId,
      action: 'erased',
      entityType: 'person',
      metadata: {
        contacts: report.contacts,
        leads: report.leads,
        messages: report.messages,
        reason: dto.reason,
      },
    });

    return report;
  }
}
