import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { randomBytes } from 'crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { DOCUMENT_STORAGE, DocumentStorage } from './storage/storage.interface';
import {
  CreateFolderDto,
  CreateShareDto,
  GenerateDocumentDto,
  QueryDocumentsDto,
  SignShareDto,
  TemplateDto,
  UpdateDocumentDto,
  UploadMetaDto,
} from './dto/documents.dto';

/** What an upload looks like once multer has parsed it. */
export interface UploadedFile {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

@Injectable()
export class DocumentsService {
  private readonly logger = new Logger(DocumentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    @Inject(DOCUMENT_STORAGE) private readonly storage: DocumentStorage,
  ) {}

  private get maxBytes(): number {
    return (
      (this.config.get<number>('documents.maxUploadMb') ?? 25) * 1024 * 1024
    );
  }

  // ── Folders ──────────────────────────────────

  listFolders(tenantId: string) {
    return this.prisma.documentFolder.findMany({
      where: { tenantId },
      orderBy: { name: 'asc' },
      include: { _count: { select: { documents: true, children: true } } },
    });
  }

  async createFolder(tenantId: string, dto: CreateFolderDto) {
    if (dto.parentId) {
      const parent = await this.prisma.documentFolder.findFirst({
        where: { id: dto.parentId, tenantId },
        select: { id: true },
      });
      if (!parent) throw new NotFoundException('Folder not found');
    }

    return this.prisma.documentFolder.create({
      data: { tenantId, name: dto.name, parentId: dto.parentId },
    });
  }

  /**
   * Removes a folder. The documents in it are kept and moved to the top
   * level: deleting a folder is tidying, not throwing away the contents.
   */
  async removeFolder(tenantId: string, id: string) {
    const folder = await this.prisma.documentFolder.findFirst({
      where: { id, tenantId },
      select: { id: true },
    });
    if (!folder) throw new NotFoundException('Folder not found');

    await this.prisma.document.updateMany({
      where: { tenantId, folderId: id },
      data: { folderId: null },
    });
    await this.prisma.documentFolder.delete({ where: { id } });
    return { success: true };
  }

  // ── Documents ────────────────────────────────

  list(tenantId: string, query: QueryDocumentsDto) {
    const where: Prisma.DocumentWhereInput = { tenantId };
    if (query.folderId) where.folderId = query.folderId;
    if (query.contactId) where.contactId = query.contactId;
    if (query.companyId) where.companyId = query.companyId;
    if (query.dealId) where.dealId = query.dealId;
    if (query.tag) where.tags = { has: query.tag };
    if (query.search) {
      where.name = { contains: query.search, mode: 'insensitive' };
    }
    if (query.expiringInDays != null) {
      const until = new Date(
        Date.now() + query.expiringInDays * 24 * 60 * 60 * 1000,
      );
      where.expiresAt = { not: null, lte: until };
    }

    return this.prisma.document.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      include: {
        folder: { select: { id: true, name: true } },
        owner: { select: { id: true, firstName: true, lastName: true } },
        contact: { select: { id: true, firstName: true, lastName: true } },
        company: { select: { id: true, name: true } },
        deal: { select: { id: true, title: true } },
        _count: { select: { versions: true, shares: true } },
      },
    });
  }

  async get(tenantId: string, id: string) {
    const document = await this.prisma.document.findFirst({
      where: { id, tenantId },
      include: {
        folder: { select: { id: true, name: true } },
        owner: { select: { id: true, firstName: true, lastName: true } },
        contact: { select: { id: true, firstName: true, lastName: true } },
        company: { select: { id: true, name: true } },
        deal: { select: { id: true, title: true } },
        versions: {
          orderBy: { version: 'desc' },
          select: {
            id: true,
            version: true,
            size: true,
            note: true,
            createdAt: true,
            author: { select: { firstName: true, lastName: true } },
          },
        },
        shares: {
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            token: true,
            version: true,
            expiresAt: true,
            revokedAt: true,
            requireSignature: true,
            views: true,
            downloads: true,
            lastSeenAt: true,
            signedName: true,
            signedAt: true,
            createdAt: true,
          },
        },
      },
    });
    if (!document) throw new NotFoundException('Document not found');
    return document;
  }

  /** Stores an uploaded file as version 1 of a new document. */
  async upload(
    tenantId: string,
    userId: string,
    file: UploadedFile,
    dto: UploadMetaDto,
  ) {
    if (!file) throw new BadRequestException('No file was uploaded');
    if (file.size > this.maxBytes) {
      throw new BadRequestException(
        `That file is larger than the ${this.config.get<number>('documents.maxUploadMb')}MB limit`,
      );
    }

    const stored = await this.storage.put(
      tenantId,
      file.originalname,
      file.buffer,
    );

    const document = await this.prisma.document.create({
      data: {
        tenantId,
        name: dto.name || file.originalname,
        folderId: dto.folderId,
        tags: dto.tags ?? [],
        storageKey: stored.key,
        mimeType: file.mimetype,
        size: stored.size,
        contactId: dto.contactId,
        companyId: dto.companyId,
        dealId: dto.dealId,
        ownerId: userId || undefined,
        expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : undefined,
      },
    });

    await this.prisma.documentVersion.create({
      data: {
        tenantId,
        documentId: document.id,
        version: 1,
        storageKey: stored.key,
        mimeType: file.mimetype,
        size: stored.size,
        note: dto.note,
        authorId: userId || undefined,
      },
    });

    return document;
  }

  /**
   * Adds a new version.
   *
   * The old bytes are left where they are: an earlier version has to remain
   * downloadable, and a share pinned to it must keep working.
   */
  async addVersion(
    tenantId: string,
    id: string,
    userId: string,
    file: UploadedFile,
    note?: string,
  ) {
    const document = await this.get(tenantId, id);
    if (!file) throw new BadRequestException('No file was uploaded');
    if (file.size > this.maxBytes) {
      throw new BadRequestException('That file is over the upload limit');
    }

    const stored = await this.storage.put(
      tenantId,
      file.originalname,
      file.buffer,
    );
    const version = document.version + 1;

    await this.prisma.documentVersion.create({
      data: {
        tenantId,
        documentId: id,
        version,
        storageKey: stored.key,
        mimeType: file.mimetype,
        size: stored.size,
        note,
        authorId: userId || undefined,
      },
    });

    return this.prisma.document.update({
      where: { id },
      data: {
        version,
        storageKey: stored.key,
        mimeType: file.mimetype,
        size: stored.size,
      },
    });
  }

  async update(tenantId: string, id: string, dto: UpdateDocumentDto) {
    await this.get(tenantId, id);

    return this.prisma.document.update({
      where: { id },
      data: {
        name: dto.name,
        folderId: dto.folderId === '' ? null : dto.folderId,
        tags: dto.tags,
        contactId: dto.contactId === '' ? null : dto.contactId,
        companyId: dto.companyId === '' ? null : dto.companyId,
        dealId: dto.dealId === '' ? null : dto.dealId,
        expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : undefined,
      },
    });
  }

  async remove(tenantId: string, id: string) {
    const document = await this.get(tenantId, id);

    // Every version's bytes, not only the newest: leaving the rest behind
    // would keep the file readable to anyone who could reach the disk.
    const versions = await this.prisma.documentVersion.findMany({
      where: { tenantId, documentId: id },
      select: { storageKey: true },
    });
    const keys = new Set([
      document.storageKey,
      ...versions.map((v) => v.storageKey),
    ]);

    await this.prisma.document.delete({ where: { id } });
    for (const key of keys) await this.storage.delete(key);

    return { success: true };
  }

  /** The bytes of a document, at its current version or an older one. */
  async download(tenantId: string, id: string, version?: number) {
    const document = await this.get(tenantId, id);

    if (version && version !== document.version) {
      const older = await this.prisma.documentVersion.findFirst({
        where: { tenantId, documentId: id, version },
      });
      if (!older) throw new NotFoundException('That version does not exist');
      return {
        name: document.name,
        mimeType: older.mimeType,
        body: await this.storage.get(older.storageKey),
      };
    }

    return {
      name: document.name,
      mimeType: document.mimeType,
      body: await this.storage.get(document.storageKey),
    };
  }

  // ── Sharing ──────────────────────────────────

  /**
   * Makes a link for somebody outside the CRM.
   *
   * The share is pinned to the version that exists now, so a later edit cannot
   * change what a customer was sent.
   */
  async createShare(
    tenantId: string,
    id: string,
    userId: string,
    dto: CreateShareDto,
  ) {
    const document = await this.get(tenantId, id);

    const share = await this.prisma.documentShare.create({
      data: {
        tenantId,
        documentId: id,
        token: randomBytes(24).toString('base64url'),
        version: document.version,
        expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : undefined,
        requireSignature: dto.requireSignature ?? false,
        createdById: userId || undefined,
      },
    });

    // The token is returned once, to whoever made the link. It is never echoed
    // back in a listing.
    return { id: share.id, token: share.token, version: share.version };
  }

  async revokeShare(tenantId: string, shareId: string) {
    const share = await this.prisma.documentShare.findFirst({
      where: { id: shareId, tenantId },
      select: { id: true },
    });
    if (!share) throw new NotFoundException('Share not found');

    await this.prisma.documentShare.update({
      where: { id: shareId },
      data: { revokedAt: new Date() },
    });
    return { success: true };
  }

  /** Resolves a share token, or explains nothing. */
  private async liveShare(token: string) {
    const share = await this.prisma.documentShare.findUnique({
      where: { token },
      include: {
        document: {
          select: { id: true, name: true, mimeType: true, size: true },
        },
        tenant: { select: { name: true } },
      },
    });

    // Revoked, expired and never-existed all look the same from outside.
    if (
      !share ||
      share.revokedAt ||
      (share.expiresAt && share.expiresAt < new Date())
    ) {
      throw new NotFoundException('This link is no longer available');
    }
    return share;
  }

  /** What the recipient sees before they download anything. */
  async viewShare(token: string, ip?: string, userAgent?: string) {
    const share = await this.liveShare(token);

    await this.prisma.documentShare.update({
      where: { id: share.id },
      data: { views: { increment: 1 }, lastSeenAt: new Date() },
    });
    await this.prisma.documentEvent.create({
      data: {
        tenantId: share.tenantId,
        documentId: share.documentId,
        shareId: share.id,
        type: 'view',
        ipAddress: ip,
        userAgent,
      },
    });

    return {
      name: share.document.name,
      mimeType: share.document.mimeType,
      size: share.document.size,
      sharedBy: share.tenant.name,
      requireSignature: share.requireSignature,
      signed: Boolean(share.signedAt),
      signedName: share.signedName,
      expiresAt: share.expiresAt,
    };
  }

  /**
   * Records who accepted the document.
   *
   * This is an acceptance record — a name, an email and the time it was typed
   * — and deliberately not a legally integrated e-signature. It says somebody
   * with the link put their name to this version; it does not certify their
   * identity.
   */
  async signShare(token: string, dto: SignShareDto, ip?: string) {
    const share = await this.liveShare(token);
    if (share.signedAt) {
      throw new BadRequestException('This document has already been signed');
    }
    if (!share.requireSignature) {
      throw new BadRequestException('This document does not ask for a name');
    }

    await this.prisma.documentShare.update({
      where: { id: share.id },
      data: {
        signedName: dto.name,
        signedEmail: dto.email,
        signedAt: new Date(),
        signedIp: ip,
      },
    });
    await this.prisma.documentEvent.create({
      data: {
        tenantId: share.tenantId,
        documentId: share.documentId,
        shareId: share.id,
        type: 'signed',
        ipAddress: ip,
      },
    });

    return { signed: true };
  }

  /** The bytes, for somebody holding the link. */
  async downloadShare(token: string, ip?: string, userAgent?: string) {
    const share = await this.liveShare(token);
    if (share.requireSignature && !share.signedAt) {
      throw new BadRequestException(
        'Please put your name to the document before downloading it',
      );
    }

    // The pinned version, not the newest: what was sent is what is served.
    const version = await this.prisma.documentVersion.findFirst({
      where: { documentId: share.documentId, version: share.version },
    });
    if (!version) throw new NotFoundException('That version is missing');

    await this.prisma.documentShare.update({
      where: { id: share.id },
      data: { downloads: { increment: 1 }, lastSeenAt: new Date() },
    });
    await this.prisma.documentEvent.create({
      data: {
        tenantId: share.tenantId,
        documentId: share.documentId,
        shareId: share.id,
        type: 'download',
        ipAddress: ip,
        userAgent,
      },
    });

    return {
      name: share.document.name,
      mimeType: version.mimeType,
      body: await this.storage.get(version.storageKey),
    };
  }

  /** Records how long a viewer had the document open. */
  async recordReadingTime(token: string, seconds: number) {
    const share = await this.liveShare(token);

    await this.prisma.documentEvent.create({
      data: {
        tenantId: share.tenantId,
        documentId: share.documentId,
        shareId: share.id,
        type: 'view',
        seconds: Math.min(Math.max(0, Math.round(seconds)), 60 * 60),
      },
    });
    return { recorded: true };
  }

  /** Who has looked at a document, and for how long. */
  async activity(tenantId: string, id: string) {
    await this.get(tenantId, id);

    const events = await this.prisma.documentEvent.findMany({
      where: { tenantId, documentId: id },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });

    const withTime = events.filter((e) => e.seconds != null);
    const totalSeconds = withTime.reduce((sum, e) => sum + (e.seconds ?? 0), 0);

    return {
      views: events.filter((e) => e.type === 'view').length,
      downloads: events.filter((e) => e.type === 'download').length,
      // Only from the views that reported a duration; averaging over views
      // that reported nothing would quietly drag it towards zero.
      averageSeconds: withTime.length
        ? Math.round(totalSeconds / withTime.length)
        : null,
      events: events.slice(0, 50),
    };
  }

  // ── Templates ────────────────────────────────

  listTemplates(tenantId: string) {
    return this.prisma.documentTemplate.findMany({
      where: { tenantId },
      orderBy: { name: 'asc' },
    });
  }

  createTemplate(tenantId: string, dto: TemplateDto) {
    return this.prisma.documentTemplate.create({
      data: {
        tenantId,
        name: dto.name,
        kind: dto.kind ?? 'other',
        body: dto.body,
      },
    });
  }

  async updateTemplate(tenantId: string, id: string, dto: TemplateDto) {
    const template = await this.prisma.documentTemplate.findFirst({
      where: { id, tenantId },
      select: { id: true },
    });
    if (!template) throw new NotFoundException('Template not found');

    return this.prisma.documentTemplate.update({
      where: { id },
      data: { name: dto.name, kind: dto.kind, body: dto.body },
    });
  }

  async removeTemplate(tenantId: string, id: string) {
    await this.prisma.documentTemplate.deleteMany({ where: { id, tenantId } });
    return { success: true };
  }

  /**
   * Fills a template in from a record and stores the result as a document.
   *
   * A merge field with nothing behind it is left visibly unfilled rather than
   * replaced with an empty string: a contract that silently reads "Agreement
   * with  " is worse than one that shows which field is missing.
   */
  async generate(tenantId: string, userId: string, dto: GenerateDocumentDto) {
    const template = await this.prisma.documentTemplate.findFirst({
      where: { id: dto.templateId, tenantId },
    });
    if (!template) throw new NotFoundException('Template not found');

    const values = await this.mergeValues(tenantId, dto);
    const missing: string[] = [];

    const body = template.body.replace(
      /\{\{\s*([\w.]+)\s*\}\}/g,
      (_match, field: string) => {
        const value = values[field];
        if (value == null || value === '') {
          missing.push(field);
          return `[${field}]`;
        }
        return String(value);
      },
    );

    const buffer = Buffer.from(body, 'utf8');
    const stored = await this.storage.put(
      tenantId,
      `${dto.name ?? template.name}.txt`,
      buffer,
    );

    const document = await this.prisma.document.create({
      data: {
        tenantId,
        name: dto.name ?? `${template.name}`,
        folderId: dto.folderId,
        storageKey: stored.key,
        mimeType: 'text/plain',
        size: stored.size,
        contactId: dto.contactId,
        companyId: dto.companyId,
        dealId: dto.dealId,
        ownerId: userId || undefined,
        tags: [template.kind],
      },
    });

    await this.prisma.documentVersion.create({
      data: {
        tenantId,
        documentId: document.id,
        version: 1,
        storageKey: stored.key,
        mimeType: 'text/plain',
        size: stored.size,
        note: `Generated from "${template.name}"`,
        authorId: userId || undefined,
      },
    });

    return {
      ...document,
      // Named so whoever generated it can fix the record rather than
      // discovering the hole in front of a customer.
      unfilledFields: [...new Set(missing)],
    };
  }

  /** The record behind a generated document, flattened to merge fields. */
  private async mergeValues(
    tenantId: string,
    dto: GenerateDocumentDto,
  ): Promise<Record<string, string | number>> {
    const values: Record<string, string | number> = {
      today: new Date().toLocaleDateString('en-IN'),
    };

    const tenant = await this.prisma.tenant.findFirst({
      where: { id: tenantId },
      select: { name: true },
    });
    if (tenant) values['our.name'] = tenant.name;

    if (dto.contactId) {
      const contact = await this.prisma.contact.findFirst({
        where: { id: dto.contactId, tenantId },
        include: { company: { select: { name: true } } },
      });
      if (contact) {
        values['contact.firstName'] = contact.firstName;
        if (contact.lastName) values['contact.lastName'] = contact.lastName;
        // Joined rather than interpolated: a contact with no surname would
        // otherwise put a double space into the middle of a contract.
        values['contact.fullName'] = [contact.firstName, contact.lastName]
          .filter(Boolean)
          .join(' ');
        if (contact.email) values['contact.email'] = contact.email;
        if (contact.phone) values['contact.phone'] = contact.phone;
        if (contact.jobTitle) values['contact.jobTitle'] = contact.jobTitle;
        if (contact.company) values['company.name'] = contact.company.name;
      }
    }

    if (dto.companyId) {
      const company = await this.prisma.company.findFirst({
        where: { id: dto.companyId, tenantId },
      });
      if (company) {
        values['company.name'] = company.name;
        if (company.city) values['company.city'] = company.city;
        if (company.state) values['company.state'] = company.state;
        if (company.country) values['company.country'] = company.country;
      }
    }

    if (dto.dealId) {
      const deal = await this.prisma.deal.findFirst({
        where: { id: dto.dealId, tenantId },
        include: { company: { select: { name: true } } },
      });
      if (deal) {
        values['deal.title'] = deal.title;
        values['deal.value'] = Number(deal.value).toLocaleString('en-IN');
        values['deal.currency'] = deal.currency;
        if (deal.company) values['company.name'] = deal.company.name;
      }
    }

    return values;
  }

  // ── Expiry ───────────────────────────────────

  /**
   * Contracts that are about to run out.
   *
   * Reported rather than acted on: what to do about an expiring contract is a
   * decision, and the CRM's job is to make sure nobody is surprised by it.
   */
  async expiring(tenantId: string, days?: number) {
    const window =
      days ?? this.config.get<number>('documents.expiryWarningDays') ?? 30;
    const until = new Date(Date.now() + window * 24 * 60 * 60 * 1000);

    const documents = await this.prisma.document.findMany({
      where: { tenantId, expiresAt: { not: null, lte: until } },
      orderBy: { expiresAt: 'asc' },
      include: {
        owner: { select: { firstName: true, lastName: true } },
        company: { select: { name: true } },
      },
    });

    const now = Date.now();
    return documents.map((d) => ({
      id: d.id,
      name: d.name,
      expiresAt: d.expiresAt,
      company: d.company?.name ?? null,
      owner: d.owner ? `${d.owner.firstName} ${d.owner.lastName}` : null,
      daysLeft: Math.ceil(
        ((d.expiresAt as Date).getTime() - now) / (24 * 60 * 60 * 1000),
      ),
    }));
  }

  /** A daily sweep, so an expiry is noticed once rather than every day. */
  @Cron(CronExpression.EVERY_DAY_AT_8AM)
  async sweepExpiries() {
    const window = this.config.get<number>('documents.expiryWarningDays') ?? 30;
    const until = new Date(Date.now() + window * 24 * 60 * 60 * 1000);

    const due = await this.prisma.document.findMany({
      where: {
        expiresAt: { not: null, lte: until },
        expiryNotifiedAt: null,
      },
      select: { id: true, tenantId: true, name: true, expiresAt: true },
    });

    for (const document of due) {
      await this.prisma.documentEvent.create({
        data: {
          tenantId: document.tenantId,
          documentId: document.id,
          type: 'expiring',
        },
      });
      await this.prisma.document.update({
        where: { id: document.id },
        data: { expiryNotifiedAt: new Date() },
      });
      this.logger.log(
        `${document.name} expires on ${document.expiresAt?.toDateString()}`,
      );
    }

    return { flagged: due.length };
  }
}
