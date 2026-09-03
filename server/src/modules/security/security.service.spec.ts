import { Test } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { createHash } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import {
  SecurityService,
  addressAllowed,
  describeDevice,
  DEFAULT_POLICY,
} from './security.service';
import { AuditService, diffRecords } from './audit.service';
import { ComplianceService } from './compliance.service';

const tenantId = 'tenant-1';
const sha = (t: string) => createHash('sha256').update(t).digest('hex');

describe('IP allowlist', () => {
  it('lets anybody in when no list is set', () => {
    expect(addressAllowed('1.2.3.4', [])).toBe(true);
    expect(addressAllowed(undefined, [])).toBe(true);
  });

  it('matches an exact address', () => {
    expect(addressAllowed('203.0.113.7', ['203.0.113.7'])).toBe(true);
    expect(addressAllowed('203.0.113.8', ['203.0.113.7'])).toBe(false);
  });

  it('matches inside a CIDR block, and not outside it', () => {
    expect(addressAllowed('203.0.113.55', ['203.0.113.0/24'])).toBe(true);
    expect(addressAllowed('203.0.114.55', ['203.0.113.0/24'])).toBe(false);
  });

  it('handles a /32 and a /0', () => {
    expect(addressAllowed('203.0.113.7', ['203.0.113.7/32'])).toBe(true);
    expect(addressAllowed('203.0.113.8', ['203.0.113.7/32'])).toBe(false);
    // A /0 shifts by 32, which JavaScript would otherwise treat as no shift.
    expect(addressAllowed('8.8.8.8', ['0.0.0.0/0'])).toBe(true);
  });

  it('sees through the IPv4-in-IPv6 form express reports', () => {
    expect(addressAllowed('::ffff:203.0.113.7', ['203.0.113.0/24'])).toBe(true);
  });

  it('refuses when a list is set and the address is unknown', () => {
    // A list is in force and we cannot tell who this is: letting it through
    // would make the allowlist advisory.
    expect(addressAllowed(undefined, ['203.0.113.0/24'])).toBe(false);
  });

  it('does not let a malformed rule open the door', () => {
    expect(addressAllowed('1.2.3.4', ['not-an-ip'])).toBe(false);
    expect(addressAllowed('1.2.3.4', ['1.2.3.4/99'])).toBe(false);
    expect(addressAllowed('1.2.3.4', ['1.2.3.999/24'])).toBe(false);
  });

  it('compares an IPv6 entry exactly rather than guessing', () => {
    expect(addressAllowed('2001:db8::1', ['2001:db8::1'])).toBe(true);
    expect(addressAllowed('2001:db8::2', ['2001:db8::1'])).toBe(false);
  });
});

describe('Device labels', () => {
  it('reads a browser and platform out of a user agent', () => {
    expect(
      describeDevice(
        'Mozilla/5.0 (Windows NT 10.0; Win64) AppleWebKit/537 Chrome/120 Safari/537',
      ),
    ).toBe('Chrome on Windows');
  });

  it('does not call Edge "Chrome"', () => {
    expect(
      describeDevice(
        'Mozilla/5.0 (Windows NT 10.0) Chrome/120 Safari/537 Edg/120',
      ),
    ).toBe('Edge on Windows');
  });

  it('says so when it has nothing to go on', () => {
    expect(describeDevice(undefined)).toBe('Unknown device');
  });
});

describe('Audit diffs', () => {
  it('reports only what changed', () => {
    const changes = diffRecords(
      { name: 'A', value: 1 },
      { name: 'B', value: 1 },
    );

    expect(changes).toEqual([{ field: 'name', from: 'A', to: 'B' }]);
  });

  it('never records a secret, even when one is handed to it', () => {
    const changes = diffRecords(
      { passwordHash: 'old', refreshToken: 'a', name: 'A' },
      { passwordHash: 'new', refreshToken: 'b', name: 'B' },
    );

    // An audit table built to be read by admins must not become the place the
    // credentials live.
    expect(changes.map((c) => c.field)).toEqual(['name']);
  });

  it('compares dates by value rather than by identity', () => {
    const same = diffRecords(
      { at: new Date('2026-01-01T00:00:00Z') },
      { at: new Date('2026-01-01T00:00:00Z') },
    );
    expect(same).toHaveLength(0);

    const moved = diffRecords(
      { at: new Date('2026-01-01Z') },
      { at: new Date('2026-02-01Z') },
    );
    expect(moved).toHaveLength(1);
  });

  it('treats null and missing as the same nothing', () => {
    expect(diffRecords({ a: null }, { a: undefined })).toHaveLength(0);
  });
});

describe('SecurityService', () => {
  let service: SecurityService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      tenantSecurity: {
        findUnique: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        upsert: jest.fn().mockResolvedValue({}),
      },
      loginAttempt: {
        create: jest.fn().mockResolvedValue({}),
        findMany: jest.fn().mockResolvedValue([]),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      userSession: {
        create: jest.fn().mockResolvedValue({ id: 's1' }),
        findUnique: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      auditLog: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        SecurityService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    service = moduleRef.get(SecurityService);
  });

  it('falls back to sensible defaults when no policy is set', async () => {
    expect(await service.policy(tenantId)).toEqual(DEFAULT_POLICY);
  });

  // ── Lockout ────────────────────────────────────

  const failures = (n: number) =>
    Array.from({ length: n }, () => ({
      success: false,
      createdAt: new Date(),
    }));

  it('locks an account out after enough failures', async () => {
    prisma.loginAttempt.findMany.mockResolvedValue(failures(5));

    const result = await service.lockout('a@b.in', DEFAULT_POLICY);

    expect(result.locked).toBe(true);
    expect(result.until).toBeInstanceOf(Date);
  });

  it('does not lock out one failure short', async () => {
    prisma.loginAttempt.findMany.mockResolvedValue(failures(4));

    expect((await service.lockout('a@b.in', DEFAULT_POLICY)).locked).toBe(
      false,
    );
  });

  it('a successful sign-in clears the slate', async () => {
    prisma.loginAttempt.findMany.mockResolvedValue([
      ...failures(2),
      { success: true, createdAt: new Date() },
      ...failures(9),
    ]);

    // Yesterday's typos must not lock somebody out today.
    const result = await service.lockout('a@b.in', DEFAULT_POLICY);
    expect(result.locked).toBe(false);
    expect(result.failures).toBe(2);
  });

  it('only counts failures inside the lockout window', async () => {
    await service.lockout('a@b.in', DEFAULT_POLICY);

    const where = prisma.loginAttempt.findMany.mock.calls[0][0].where;
    expect(where.createdAt.gte).toBeInstanceOf(Date);
    expect(where.email).toBe('a@b.in');
  });

  it('lowercases the address, so casing cannot dodge a lockout', async () => {
    await service.recordAttempt({ email: 'A@B.IN', success: false });

    expect(prisma.loginAttempt.create.mock.calls[0][0].data.email).toBe(
      'a@b.in',
    );
  });

  // ── Sessions ───────────────────────────────────

  it('stores the refresh token hashed, never in the clear', async () => {
    await service.createSession({
      tenantId,
      userId: 'u1',
      refreshToken: 'raw-token',
      sessionDays: 7,
      userAgent: 'Chrome/120 Windows',
    });

    const data = prisma.userSession.create.mock.calls[0][0].data;
    expect(data.tokenHash).toBe(sha('raw-token'));
    expect(JSON.stringify(data)).not.toContain('raw-token');
    expect(data.device).toContain('Chrome');
  });

  it('will not resolve a revoked or expired session', async () => {
    prisma.userSession.findUnique.mockResolvedValue({
      id: 's1',
      revokedAt: new Date(),
      expiresAt: new Date(Date.now() + 1000),
    });
    expect(await service.liveSession('tok')).toBeNull();

    prisma.userSession.findUnique.mockResolvedValue({
      id: 's1',
      revokedAt: null,
      expiresAt: new Date(Date.now() - 1000),
    });
    expect(await service.liveSession('tok')).toBeNull();
  });

  it('rotating swaps the token the session answers to', async () => {
    await service.rotateSession('s1', 'new-token', '1.2.3.4');

    // The old token stops working the moment the new one exists.
    expect(prisma.userSession.update.mock.calls[0][0].data.tokenHash).toBe(
      sha('new-token'),
    );
  });

  it('will not let one person sign another out by guessing an id', async () => {
    await service.revokeSession(tenantId, 'u1', 's-someone-else');

    expect(prisma.userSession.updateMany.mock.calls[0][0].where).toMatchObject({
      tenantId,
      userId: 'u1',
      id: 's-someone-else',
    });
  });

  it('can sign out everywhere except the device asking', async () => {
    await service.revokeAll('u1', 'password_changed', 's1');

    expect(prisma.userSession.updateMany.mock.calls[0][0].where.id).toEqual({
      not: 's1',
    });
  });

  // ── Retention ──────────────────────────────────

  it('only deletes history where a retention period was actually chosen', async () => {
    await service.applyRetention();

    // Discarding a tenant's audit trail because nobody picked a number would
    // be worse than keeping it.
    const where = prisma.tenantSecurity.findMany.mock.calls[0][0].where;
    expect(where.OR).toEqual([
      { loginRetentionDays: { not: null } },
      { auditRetentionDays: { not: null } },
    ]);
    expect(prisma.auditLog.deleteMany).not.toHaveBeenCalled();
  });

  it('deletes only what is older than the period', async () => {
    prisma.tenantSecurity.findMany.mockResolvedValue([
      { tenantId, loginRetentionDays: 30, auditRetentionDays: null },
    ]);

    await service.applyRetention();

    expect(
      prisma.loginAttempt.deleteMany.mock.calls[0][0].where.createdAt.lt,
    ).toBeInstanceOf(Date);
    expect(prisma.auditLog.deleteMany).not.toHaveBeenCalled();
  });

  it('closes sessions that have simply run out', async () => {
    await service.expireSessions();

    expect(
      prisma.userSession.updateMany.mock.calls[0][0].data.revokedReason,
    ).toBe('expired');
  });
});

describe('ComplianceService', () => {
  let service: ComplianceService;
  let prisma: any;
  let audit: { record: jest.Mock };

  beforeEach(async () => {
    const empty = () => ({ findMany: jest.fn().mockResolvedValue([]) });
    prisma = {
      tenant: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ id: tenantId, name: 'Acme', slug: 'acme' }),
      },
      user: empty(),
      contact: {
        ...empty(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      company: empty(),
      deal: empty(),
      lead: {
        ...empty(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      activity: empty(),
      task: empty(),
      conversation: empty(),
      message: {
        ...empty(),
        updateMany: jest.fn().mockResolvedValue({ count: 3 }),
      },
      quote: empty(),
      invoice: empty(),
      ticket: empty(),
      article: empty(),
      document: empty(),
      formSubmission: {
        ...empty(),
        updateMany: jest.fn().mockResolvedValue({ count: 2 }),
      },
      portalSession: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      documentShare: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    };
    audit = { record: jest.fn().mockResolvedValue({}) };

    const moduleRef = await Test.createTestingModule({
      providers: [
        ComplianceService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditService, useValue: audit },
      ],
    }).compile();
    service = moduleRef.get(ComplianceService);
  });

  it('keeps credentials out of an export', async () => {
    prisma.quote.findMany.mockResolvedValue([
      { id: 'q1', number: 'Q-1', publicToken: 'secret-token' },
    ]);
    prisma.ticket.findMany.mockResolvedValue([
      { id: 't1', number: 'T-1', csatToken: 'csat-secret' },
    ]);
    prisma.document.findMany.mockResolvedValue([
      { id: 'd1', name: 'MSA', storageKey: 'tenant-1/abc.pdf' },
    ]);

    const dump = JSON.stringify(await service.exportTenant(tenantId));

    expect(dump).not.toContain('secret-token');
    expect(dump).not.toContain('csat-secret');
    expect(dump).not.toContain('tenant-1/abc.pdf');
  });

  it('records who took the export, not "the system"', async () => {
    await service.exportTenant(tenantId, 'u1');

    expect(audit.record.mock.calls[0][0]).toMatchObject({
      userId: 'u1',
      action: 'exported',
    });
  });

  it('exports the user list without password hashes', async () => {
    await service.exportTenant(tenantId);

    const select = prisma.user.findMany.mock.calls[0][0].select;
    expect(select.passwordHash).toBeUndefined();
    expect(select.refreshToken).toBeUndefined();
  });

  it('refuses an erasure that was not deliberately confirmed', async () => {
    await expect(
      service.erasePerson(tenantId, 'u1', {
        email: 'a@b.in',
        confirm: false,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('says so when there is nobody to erase', async () => {
    await expect(
      service.erasePerson(tenantId, 'u1', {
        email: 'nobody@b.in',
        confirm: true,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('overwrites the person rather than deleting the commercial record', async () => {
    prisma.contact.findMany.mockResolvedValue([{ id: 'c1' }]);
    prisma.lead.findMany.mockResolvedValue([]);

    const report = await service.erasePerson(tenantId, 'u1', {
      email: 'priya@globex.in',
      confirm: true,
    });

    // Deleting the contact would take the deals, invoices and tickets a
    // business has to keep with it.
    const data = prisma.contact.updateMany.mock.calls[0][0].data;
    expect(data).toMatchObject({ firstName: '[erased]', email: null });
    expect(report.contacts).toBe(1);
    expect(report.messages).toBe(3);
  });

  it('signs the person out of the portal as part of erasing them', async () => {
    prisma.contact.findMany.mockResolvedValue([{ id: 'c1' }]);
    prisma.lead.findMany.mockResolvedValue([]);

    await service.erasePerson(tenantId, 'u1', {
      email: 'priya@globex.in',
      confirm: true,
    });

    expect(
      prisma.portalSession.updateMany.mock.calls[0][0].data.revokedAt,
    ).toBeInstanceOf(Date);
  });

  it('does not leave the address in the trail that proves it was erased', async () => {
    prisma.contact.findMany.mockResolvedValue([{ id: 'c1' }]);
    prisma.lead.findMany.mockResolvedValue([]);

    await service.erasePerson(tenantId, 'u1', {
      email: 'priya@globex.in',
      confirm: true,
      reason: 'GDPR request',
    });

    expect(JSON.stringify(audit.record.mock.calls[0][0])).not.toContain(
      'priya@globex.in',
    );
  });
});
