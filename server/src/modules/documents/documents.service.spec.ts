import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { mkdtemp, readFile, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { PrismaService } from '../../prisma/prisma.service';
import { DocumentsService } from './documents.service';
import { DOCUMENT_STORAGE } from './storage/storage.interface';
import { LocalDiskStorage } from './storage/local-disk.storage';

const tenantId = 'tenant-1';

const file = (over: Record<string, unknown> = {}) => ({
  originalname: 'contract.pdf',
  mimetype: 'application/pdf',
  size: 1024,
  buffer: Buffer.from('pretend pdf'),
  ...over,
});

describe('LocalDiskStorage', () => {
  let storage: LocalDiskStorage;
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'crm-docs-'));
    storage = new LocalDiskStorage({
      get: () => root,
    } as unknown as ConfigService);
  });

  it('stores and reads the bytes back', async () => {
    const stored = await storage.put(tenantId, 'a.pdf', Buffer.from('hello'));

    expect(stored.size).toBe(5);
    expect((await storage.get(stored.key)).toString()).toBe('hello');
  });

  it('keeps each tenant under its own prefix', async () => {
    const mine = await storage.put('tenant-a', 'a.pdf', Buffer.from('x'));
    const theirs = await storage.put('tenant-b', 'a.pdf', Buffer.from('y'));

    expect(mine.key.startsWith('tenant-a/')).toBe(true);
    expect(theirs.key.startsWith('tenant-b/')).toBe(true);
  });

  it('names the object itself rather than trusting the filename', async () => {
    const stored = await storage.put(
      tenantId,
      '../../../etc/passwd',
      Buffer.from('x'),
    );

    // The extension is all that survives; the path the caller sent does not.
    expect(stored.key).not.toContain('..');
    expect(stored.key).not.toContain('passwd');
  });

  it('refuses a key that climbs out of the storage root', async () => {
    // Even if a row in the database were tampered with, the driver will not
    // read a file outside the directory it owns.
    await expect(storage.get('../../../etc/passwd')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('reports a missing file as missing rather than crashing', async () => {
    await expect(storage.get('tenant-1/nothing.pdf')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('deleting something that is already gone is not an error', async () => {
    await expect(storage.delete('tenant-1/gone.pdf')).resolves.toBeUndefined();
  });

  it('really removes the bytes', async () => {
    const stored = await storage.put(tenantId, 'a.pdf', Buffer.from('x'));
    await storage.delete(stored.key);

    await expect(storage.get(stored.key)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('does not let one tenant read another tenant object by guessing', async () => {
    const theirs = await storage.put(
      'tenant-b',
      'a.pdf',
      Buffer.from('secret'),
    );
    // The key is random, so there is nothing to guess; this pins that the name
    // carries no hint of the content or the original filename.
    expect(theirs.key).toMatch(/^tenant-b\/[0-9a-f]{32}\.pdf$/);
  });

  it('a key with a null byte cannot smuggle a path through', async () => {
    await expect(storage.get('tenant-1/../../secret')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('reads a file that is really there', async () => {
    const stored = await storage.put(tenantId, 'a.txt', Buffer.from('one'));
    await writeFile(join(root, stored.key), 'two');

    expect((await readFile(join(root, stored.key))).toString()).toBe('two');
    expect((await storage.get(stored.key)).toString()).toBe('two');
  });
});

describe('DocumentsService', () => {
  let service: DocumentsService;
  let prisma: any;
  let storage: {
    put: jest.Mock;
    get: jest.Mock;
    delete: jest.Mock;
  };

  const document = (over: Record<string, unknown> = {}) => ({
    id: 'd1',
    tenantId,
    name: 'Contract.pdf',
    storageKey: 'tenant-1/abc.pdf',
    mimeType: 'application/pdf',
    size: 100,
    version: 1,
    versions: [],
    shares: [],
    ...over,
  });

  beforeEach(async () => {
    prisma = {
      document: {
        findFirst: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest
          .fn()
          .mockImplementation(({ data }: any) =>
            Promise.resolve({ id: 'd1', ...data }),
          ),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        delete: jest.fn().mockResolvedValue({}),
      },
      documentVersion: {
        findFirst: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockResolvedValue({}),
      },
      documentShare: {
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        create: jest
          .fn()
          .mockImplementation(({ data }: any) =>
            Promise.resolve({ id: 's1', ...data }),
          ),
        update: jest.fn().mockResolvedValue({}),
      },
      documentEvent: {
        create: jest.fn().mockResolvedValue({}),
        findMany: jest.fn().mockResolvedValue([]),
      },
      documentFolder: {
        findFirst: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn(),
        delete: jest.fn(),
      },
      documentTemplate: {
        findFirst: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        deleteMany: jest.fn(),
      },
      tenant: { findFirst: jest.fn().mockResolvedValue({ name: 'Acme Corp' }) },
      contact: { findFirst: jest.fn() },
      company: { findFirst: jest.fn() },
      deal: { findFirst: jest.fn() },
    };
    storage = {
      put: jest
        .fn()
        .mockImplementation((_t: string, _n: string, data: Buffer) =>
          Promise.resolve({ key: 'tenant-1/new.bin', size: data.byteLength }),
        ),
      get: jest.fn().mockResolvedValue(Buffer.from('bytes')),
      delete: jest.fn().mockResolvedValue(undefined),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        DocumentsService,
        { provide: PrismaService, useValue: prisma },
        { provide: DOCUMENT_STORAGE, useValue: storage },
        {
          provide: ConfigService,
          useValue: {
            get: (key: string) =>
              key === 'documents.maxUploadMb'
                ? 25
                : key === 'documents.expiryWarningDays'
                  ? 30
                  : undefined,
          },
        },
      ],
    }).compile();
    service = moduleRef.get(DocumentsService);
  });

  // ── Uploads and versions ───────────────────────

  it('stores an upload as version 1', async () => {
    await service.upload(tenantId, 'u1', file() as never, {});

    expect(prisma.documentVersion.create.mock.calls[0][0].data).toMatchObject({
      version: 1,
      documentId: 'd1',
    });
  });

  it('refuses a file over the limit', async () => {
    await expect(
      service.upload(
        tenantId,
        'u1',
        file({ size: 26 * 1024 * 1024 }) as never,
        {},
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(storage.put).not.toHaveBeenCalled();
  });

  it('refuses an upload with no file at all', async () => {
    await expect(
      service.upload(tenantId, 'u1', undefined as never, {}),
    ).rejects.toThrow('No file');
  });

  it('a new version keeps the old bytes rather than replacing them', async () => {
    prisma.document.findFirst.mockResolvedValue(document({ version: 2 }));

    await service.addVersion(tenantId, 'd1', 'u1', file() as never, 'redlines');

    expect(prisma.documentVersion.create.mock.calls[0][0].data.version).toBe(3);
    // An earlier version has to stay downloadable, and a share pinned to it
    // has to keep working.
    expect(storage.delete).not.toHaveBeenCalled();
  });

  it('downloads an older version when one is asked for', async () => {
    prisma.document.findFirst.mockResolvedValue(document({ version: 3 }));
    prisma.documentVersion.findFirst.mockResolvedValue({
      version: 1,
      storageKey: 'tenant-1/v1.pdf',
      mimeType: 'application/pdf',
    });

    await service.download(tenantId, 'd1', 1);

    expect(storage.get).toHaveBeenCalledWith('tenant-1/v1.pdf');
  });

  it('deleting removes every version bytes, not only the newest', async () => {
    prisma.document.findFirst.mockResolvedValue(
      document({ storageKey: 'tenant-1/v3.pdf' }),
    );
    prisma.documentVersion.findMany.mockResolvedValue([
      { storageKey: 'tenant-1/v1.pdf' },
      { storageKey: 'tenant-1/v2.pdf' },
      { storageKey: 'tenant-1/v3.pdf' },
    ]);

    await service.remove(tenantId, 'd1');

    // Leaving the rest behind keeps the file readable to anyone who can reach
    // the disk.
    const deleted = storage.delete.mock.calls.map((c) => c[0]).sort();
    expect(deleted).toEqual([
      'tenant-1/v1.pdf',
      'tenant-1/v2.pdf',
      'tenant-1/v3.pdf',
    ]);
  });

  it('another tenant document is not found', async () => {
    prisma.document.findFirst.mockResolvedValue(null);

    await expect(service.get('tenant-2', 'd1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(prisma.document.findFirst.mock.calls[0][0].where).toMatchObject({
      tenantId: 'tenant-2',
    });
  });

  it('deleting a folder keeps the documents in it', async () => {
    prisma.documentFolder.findFirst.mockResolvedValue({ id: 'f1' });

    await service.removeFolder(tenantId, 'f1');

    expect(prisma.document.updateMany.mock.calls[0][0].data).toEqual({
      folderId: null,
    });
  });

  // ── Sharing ────────────────────────────────────

  it('pins a share to the version that exists when it is made', async () => {
    prisma.document.findFirst.mockResolvedValue(document({ version: 2 }));

    const share = await service.createShare(tenantId, 'd1', 'u1', {});

    // A later edit must not change what a customer was sent.
    expect(share.version).toBe(2);
    expect(share.token.length).toBeGreaterThan(20);
  });

  const share = (over: Record<string, unknown> = {}) => ({
    id: 's1',
    tenantId,
    documentId: 'd1',
    version: 1,
    revokedAt: null,
    expiresAt: null,
    requireSignature: false,
    signedAt: null,
    document: {
      id: 'd1',
      name: 'Contract.pdf',
      mimeType: 'application/pdf',
      size: 10,
    },
    tenant: { name: 'Acme Corp' },
    ...over,
  });

  it('serves the pinned version, not the newest', async () => {
    prisma.documentShare.findUnique.mockResolvedValue(share({ version: 1 }));
    prisma.documentVersion.findFirst.mockResolvedValue({
      version: 1,
      storageKey: 'tenant-1/v1.pdf',
      mimeType: 'application/pdf',
    });

    await service.downloadShare('tok');

    expect(
      prisma.documentVersion.findFirst.mock.calls[0][0].where.version,
    ).toBe(1);
    expect(storage.get).toHaveBeenCalledWith('tenant-1/v1.pdf');
  });

  it('a revoked link is indistinguishable from one that never existed', async () => {
    const messages: string[] = [];
    for (const row of [
      null,
      share({ revokedAt: new Date() }),
      share({ expiresAt: new Date(Date.now() - 1000) }),
    ]) {
      prisma.documentShare.findUnique.mockResolvedValue(row);
      await service.viewShare('tok').catch((e) => messages.push(e.message));
    }

    expect(messages).toHaveLength(3);
    expect(new Set(messages).size).toBe(1);
  });

  it('counts a view against the share', async () => {
    prisma.documentShare.findUnique.mockResolvedValue(share());

    await service.viewShare('tok', '1.2.3.4', 'Firefox');

    expect(prisma.documentShare.update.mock.calls[0][0].data.views).toEqual({
      increment: 1,
    });
    expect(prisma.documentEvent.create.mock.calls[0][0].data).toMatchObject({
      type: 'view',
      ipAddress: '1.2.3.4',
    });
  });

  it('does not expose the document id to whoever holds the link', async () => {
    prisma.documentShare.findUnique.mockResolvedValue(share());

    const view = await service.viewShare('tok');

    expect(view).not.toHaveProperty('id');
    expect(view).not.toHaveProperty('documentId');
  });

  it('holds the file back until an asked-for name is given', async () => {
    prisma.documentShare.findUnique.mockResolvedValue(
      share({ requireSignature: true, signedAt: null }),
    );

    await expect(service.downloadShare('tok')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(storage.get).not.toHaveBeenCalled();
  });

  it('records who accepted it, and refuses a second signature', async () => {
    prisma.documentShare.findUnique.mockResolvedValue(
      share({ requireSignature: true }),
    );

    await service.signShare('tok', { name: 'Priya Sharma' }, '1.2.3.4');
    expect(prisma.documentShare.update.mock.calls[0][0].data).toMatchObject({
      signedName: 'Priya Sharma',
      signedIp: '1.2.3.4',
    });

    prisma.documentShare.findUnique.mockResolvedValue(
      share({ requireSignature: true, signedAt: new Date() }),
    );
    await expect(
      service.signShare('tok', { name: 'Someone Else' }),
    ).rejects.toThrow('already been signed');
  });

  it('will not take a signature on a document that did not ask for one', async () => {
    prisma.documentShare.findUnique.mockResolvedValue(
      share({ requireSignature: false }),
    );

    await expect(
      service.signShare('tok', { name: 'Priya' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('caps a reported reading time at an hour', async () => {
    prisma.documentShare.findUnique.mockResolvedValue(share());

    await service.recordReadingTime('tok', 999_999);

    expect(prisma.documentEvent.create.mock.calls[0][0].data.seconds).toBe(
      3600,
    );
  });

  it('averages reading time over the views that reported one', async () => {
    prisma.document.findFirst.mockResolvedValue(document());
    prisma.documentEvent.findMany.mockResolvedValue([
      { type: 'view', seconds: 60 },
      { type: 'view', seconds: 120 },
      { type: 'view', seconds: null },
      { type: 'download', seconds: null },
    ]);

    const activity = await service.activity(tenantId, 'd1');

    // Counting the silent ones would drag the average towards zero.
    expect(activity.averageSeconds).toBe(90);
    expect(activity.views).toBe(3);
    expect(activity.downloads).toBe(1);
  });

  // ── Templates ──────────────────────────────────

  it('fills a template in from the record', async () => {
    prisma.documentTemplate.findFirst.mockResolvedValue({
      id: 't1',
      name: 'NDA',
      kind: 'contract',
      body: 'Agreement between {{our.name}} and {{contact.fullName}} of {{company.name}}.',
    });
    prisma.contact.findFirst.mockResolvedValue({
      firstName: 'Priya',
      lastName: 'Sharma',
      email: 'priya@globex.in',
      company: { name: 'Globex' },
    });

    const result = await service.generate(tenantId, 'u1', {
      templateId: 't1',
      contactId: 'c1',
    });

    const written = storage.put.mock.calls[0][2].toString();
    expect(written).toBe(
      'Agreement between Acme Corp and Priya Sharma of Globex.',
    );
    expect(result.unfilledFields).toHaveLength(0);
  });

  it('does not put a double space in a name that has no surname', async () => {
    prisma.documentTemplate.findFirst.mockResolvedValue({
      id: 't1',
      name: 'NDA',
      kind: 'contract',
      body: 'Agreement with {{contact.fullName}} of {{company.name}}.',
    });
    prisma.contact.findFirst.mockResolvedValue({
      firstName: 'Vikram',
      lastName: '',
      company: { name: 'Umbrella' },
    });

    await service.generate(tenantId, 'u1', {
      templateId: 't1',
      contactId: 'c1',
    });

    expect(storage.put.mock.calls[0][2].toString()).toBe(
      'Agreement with Vikram of Umbrella.',
    );
  });

  it('leaves a field it cannot fill visible, and says which', async () => {
    prisma.documentTemplate.findFirst.mockResolvedValue({
      id: 't1',
      name: 'NDA',
      kind: 'contract',
      body: 'Agreement with {{contact.fullName}} at {{contact.jobTitle}}.',
    });
    prisma.contact.findFirst.mockResolvedValue({
      firstName: 'Priya',
      lastName: 'Sharma',
      jobTitle: null,
      company: null,
    });

    const result = await service.generate(tenantId, 'u1', {
      templateId: 't1',
      contactId: 'c1',
    });

    // A contract that silently reads "Agreement with  " is worse than one
    // that shows the hole.
    expect(storage.put.mock.calls[0][2].toString()).toContain(
      '[contact.jobTitle]',
    );
    expect(result.unfilledFields).toEqual(['contact.jobTitle']);
  });

  it('refuses to generate from a template in another tenant', async () => {
    prisma.documentTemplate.findFirst.mockResolvedValue(null);

    await expect(
      service.generate(tenantId, 'u1', { templateId: 'theirs' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  // ── Expiry ─────────────────────────────────────

  it('reports how long is left on an expiring contract', async () => {
    const inTenDays = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000);
    prisma.document.findMany.mockResolvedValue([
      {
        id: 'd1',
        name: 'MSA.pdf',
        expiresAt: inTenDays,
        owner: { firstName: 'Ravi', lastName: 'Rep' },
        company: { name: 'Globex' },
      },
    ]);

    const rows = await service.expiring(tenantId);

    expect(rows[0]).toMatchObject({ name: 'MSA.pdf', daysLeft: 10 });
  });

  it('flags an expiry once rather than every day', async () => {
    prisma.document.findMany.mockResolvedValue([
      { id: 'd1', tenantId, name: 'MSA.pdf', expiresAt: new Date() },
    ]);

    const result = await service.sweepExpiries();

    expect(result.flagged).toBe(1);
    expect(
      prisma.document.update.mock.calls[0][0].data.expiryNotifiedAt,
    ).toBeInstanceOf(Date);
    expect(
      prisma.document.findMany.mock.calls[0][0].where.expiryNotifiedAt,
    ).toBe(null);
  });
});
