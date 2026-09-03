import { Test } from '@nestjs/testing';
import { NotFoundException, UnauthorizedException } from '@nestjs/common';
import { createHash } from 'crypto';
import { WorkflowTrigger } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ApiKeysService, scopeAllows } from './api-keys.service';
import {
  WebhooksService,
  backoffSeconds,
  eventName,
  signPayload,
  verifySignature,
} from './webhooks.service';
import { requiredScope } from '../../common/guards/jwt-auth.guard';

const tenantId = 'tenant-1';
const sha = (v: string) => createHash('sha256').update(v).digest('hex');

describe('Scopes', () => {
  it('a wildcard covers everything', () => {
    expect(scopeAllows(['*'], 'contacts:write')).toBe(true);
  });

  it('an exact scope covers exactly itself', () => {
    expect(scopeAllows(['contacts:read'], 'contacts:read')).toBe(true);
    expect(scopeAllows(['contacts:read'], 'deals:read')).toBe(false);
  });

  it('a resource wildcard covers every action on it, and nothing else', () => {
    expect(scopeAllows(['contacts:*'], 'contacts:write')).toBe(true);
    expect(scopeAllows(['contacts:*'], 'deals:write')).toBe(false);
  });

  it('writing implies reading', () => {
    // A key that may change a contact may obviously see it.
    expect(scopeAllows(['contacts:write'], 'contacts:read')).toBe(true);
  });

  it('reading does not imply writing', () => {
    expect(scopeAllows(['contacts:read'], 'contacts:write')).toBe(false);
  });

  it('holding no scopes allows nothing', () => {
    expect(scopeAllows([], 'contacts:read')).toBe(false);
  });
});

describe('What a request needs permission for', () => {
  const request = (method: string, path: string) => ({ method, path }) as never;

  it('reads the resource from the path and the action from the method', () => {
    expect(requiredScope(request('GET', '/api/contacts'))).toEqual({
      resource: 'contacts',
      scope: 'contacts:read',
    });
    expect(requiredScope(request('POST', '/api/contacts'))).toEqual({
      resource: 'contacts',
      scope: 'contacts:write',
    });
  });

  it('treats anything that is not a read as a write', () => {
    for (const method of ['POST', 'PATCH', 'PUT', 'DELETE']) {
      expect(requiredScope(request(method, '/api/deals/1')).scope).toBe(
        'deals:write',
      );
    }
  });

  it('uses the first path segment, not the whole path', () => {
    expect(
      requiredScope(request('GET', '/api/marketing/pages/stats')).resource,
    ).toBe('marketing');
  });
});

describe('Webhook signatures', () => {
  const secret = 'whsec_test';
  const body = JSON.stringify({ event: 'deal.created' });

  it('verifies a signature it produced', () => {
    const at = 1_700_000_000;
    expect(
      verifySignature(secret, at, body, signPayload(secret, at, body)),
    ).toBe(true);
  });

  it('rejects a different secret', () => {
    const at = 1_700_000_000;
    expect(
      verifySignature('whsec_other', at, body, signPayload(secret, at, body)),
    ).toBe(false);
  });

  it('rejects a changed body', () => {
    const at = 1_700_000_000;
    const signature = signPayload(secret, at, body);
    expect(verifySignature(secret, at, `${body} `, signature)).toBe(false);
  });

  it('rejects a replay under a different timestamp', () => {
    // The timestamp is signed with the body, so a captured delivery cannot be
    // presented again as if it were fresh.
    const signature = signPayload(secret, 1_700_000_000, body);
    expect(verifySignature(secret, 1_700_000_900, body, signature)).toBe(false);
  });

  it('does not fall over on a signature of the wrong length', () => {
    expect(verifySignature(secret, 1, body, 'short')).toBe(false);
  });
});

describe('Retry backoff', () => {
  it('waits longer after each failure', () => {
    const waits = [1, 2, 3, 4].map(backoffSeconds);
    expect(waits).toEqual([30, 120, 480, 1920]);
    expect(waits.every((w, i) => i === 0 || w > waits[i - 1])).toBe(true);
  });
});

describe('Event names', () => {
  const event = (over: Record<string, unknown>) =>
    ({ tenantId, record: {}, ...over }) as never;

  it('names a creation after the thing created', () => {
    expect(
      eventName(
        event({ trigger: WorkflowTrigger.RECORD_CREATED, entity: 'deal' }),
      ),
    ).toBe('deal.created');
  });

  it('gives a stage move its own name', () => {
    expect(
      eventName(
        event({
          trigger: WorkflowTrigger.FIELD_CHANGED,
          entity: 'deal',
          changed: { field: 'stageId', from: 'a', to: 'b' },
        }),
      ),
    ).toBe('deal.stage_changed');
  });

  it('calls any other field change an update', () => {
    expect(
      eventName(
        event({
          trigger: WorkflowTrigger.FIELD_CHANGED,
          entity: 'deal',
          changed: { field: 'value', from: 1, to: 2 },
        }),
      ),
    ).toBe('deal.updated');
  });

  it('says nothing for an event with no record behind it', () => {
    expect(eventName(event({ trigger: WorkflowTrigger.SCHEDULE }))).toBeNull();
  });
});

describe('ApiKeysService', () => {
  let service: ApiKeysService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      apiKey: {
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn(),
        create: jest
          .fn()
          .mockImplementation(({ data }: any) =>
            Promise.resolve({ id: 'k1', ...data }),
          ),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };

    const moduleRef = await Test.createTestingModule({
      providers: [ApiKeysService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = moduleRef.get(ApiKeysService);
  });

  it('returns the key once and stores only its hash', async () => {
    const result = await service.create(tenantId, 'u1', { name: 'CI' });

    const stored = prisma.apiKey.create.mock.calls[0][0].data;
    expect(stored.keyHash).toBe(sha(result.key));
    expect(JSON.stringify(stored)).not.toContain(result.key);
    // Enough of it is kept to recognise the key in a list, and no more.
    expect(result.key.startsWith(stored.prefix)).toBe(true);
    expect(stored.prefix.length).toBeLessThan(result.key.length);
  });

  it('defaults to full access only when nothing is asked for', async () => {
    await service.create(tenantId, 'u1', { name: 'CI' });
    expect(prisma.apiKey.create.mock.calls[0][0].data.scopes).toEqual(['*']);

    await service.create(tenantId, 'u1', {
      name: 'Read only',
      scopes: ['contacts:read'],
    });
    expect(prisma.apiKey.create.mock.calls[1][0].data.scopes).toEqual([
      'contacts:read',
    ]);
  });

  it('refuses anything that is not one of our keys', async () => {
    await expect(
      service.authenticate('sk_someone_elses'),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(prisma.apiKey.findUnique).not.toHaveBeenCalled();
  });

  it('unknown, revoked and expired all read the same', async () => {
    const messages: string[] = [];
    const cases = [
      null,
      { id: 'k1', tenantId, revokedAt: new Date(), scopes: [] },
      {
        id: 'k1',
        tenantId,
        revokedAt: null,
        expiresAt: new Date(0),
        scopes: [],
      },
    ];

    for (const row of cases) {
      prisma.apiKey.findUnique.mockResolvedValue(row);
      await service.authenticate('crm_something').catch((e) => {
        messages.push(e.message);
      });
    }

    expect(messages).toHaveLength(3);
    expect(new Set(messages).size).toBe(1);
  });

  it('records that a live key was used', async () => {
    prisma.apiKey.findUnique.mockResolvedValue({
      id: 'k1',
      tenantId,
      revokedAt: null,
      expiresAt: null,
      scopes: ['*'],
      rateLimitPerMinute: 120,
    });

    const identity = await service.authenticate('crm_good', '1.2.3.4');

    expect(identity).toMatchObject({ apiKeyId: 'k1', tenantId });
    expect(prisma.apiKey.update.mock.calls[0][0].data).toMatchObject({
      lastUsedIp: '1.2.3.4',
      requestCount: { increment: 1 },
    });
  });

  it('lets a key through up to its limit, and not past it', () => {
    for (let i = 0; i < 3; i += 1) {
      expect(service.withinRateLimit('k1', 3)).toBe(true);
    }
    expect(service.withinRateLimit('k1', 3)).toBe(false);
    // A different key has its own allowance.
    expect(service.withinRateLimit('k2', 3)).toBe(true);
  });

  it('says nothing was revoked rather than pretending', async () => {
    prisma.apiKey.updateMany.mockResolvedValue({ count: 0 });

    await expect(service.revoke(tenantId, 'nope')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

describe('WebhooksService', () => {
  let service: WebhooksService;
  let prisma: any;
  let fetchMock: jest.Mock;

  const delivery = (over: Record<string, unknown> = {}) => ({
    id: 'd1',
    tenantId,
    webhookId: 'w1',
    event: 'deal.created',
    payload: { event: 'deal.created' },
    status: 'pending',
    attempts: 0,
    webhook: {
      id: 'w1',
      url: 'https://example.test/hook',
      secret: 'whsec_test',
    },
    ...over,
  });

  beforeEach(async () => {
    prisma = {
      webhook: {
        findFirst: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest
          .fn()
          .mockImplementation(({ data }: any) =>
            Promise.resolve({ id: 'w1', ...data }),
          ),
        update: jest
          .fn()
          .mockResolvedValue({ consecutiveFailures: 1, isActive: true }),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      webhookDelivery: {
        findFirst: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest
          .fn()
          .mockImplementation(({ data }: any) =>
            Promise.resolve({ id: 'd-new', ...data }),
          ),
        update: jest.fn().mockResolvedValue({}),
      },
    };

    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;

    const moduleRef = await Test.createTestingModule({
      providers: [
        WebhooksService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    service = moduleRef.get(WebhooksService);
  });

  it('returns the signing secret once, on creation', async () => {
    const created = await service.create(tenantId, {
      name: 'Zapier',
      url: 'https://example.test/hook',
      events: ['deal.created'],
    });

    expect(created.secret).toMatch(/^whsec_/);
    // The listing has no way of giving it back.
    await service.list(tenantId);
    expect(
      Object.keys(prisma.webhook.findMany.mock.calls[0][0].select),
    ).not.toContain('secret');
  });

  it('only queues to destinations that asked for the event', async () => {
    await service.dispatch(tenantId, 'deal.created', {});

    expect(prisma.webhook.findMany.mock.calls[0][0].where).toMatchObject({
      isActive: true,
      events: { has: 'deal.created' },
    });
  });

  it('signs the delivery with the timestamp it sends', async () => {
    prisma.webhookDelivery.findFirst.mockResolvedValue(delivery());
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => 'ok',
    });

    await service.attempt('d1', tenantId);

    const [, init] = fetchMock.mock.calls[0];
    const headers = init.headers as Record<string, string>;
    const at = Number(headers['X-CRM-Timestamp']);
    const signature = headers['X-CRM-Signature'].replace('sha256=', '');

    expect(verifySignature('whsec_test', at, init.body, signature)).toBe(true);
  });

  it('marks a delivery delivered and forgives the destination', async () => {
    prisma.webhookDelivery.findFirst.mockResolvedValue(delivery());
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => '',
    });

    await service.attempt('d1', tenantId);

    expect(prisma.webhookDelivery.update.mock.calls[0][0].data).toMatchObject({
      status: 'delivered',
      attempts: 1,
    });
    expect(prisma.webhook.update.mock.calls[0][0].data).toMatchObject({
      consecutiveFailures: 0,
    });
  });

  it('schedules a retry after a failure rather than giving up', async () => {
    prisma.webhookDelivery.findFirst.mockResolvedValue(delivery());
    fetchMock.mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => 'boom',
    });

    await service.attempt('d1', tenantId);

    const data = prisma.webhookDelivery.update.mock.calls[0][0].data;
    expect(data.status).toBe('pending');
    expect(data.nextAttemptAt).toBeInstanceOf(Date);
  });

  it('gives up after the last attempt', async () => {
    prisma.webhookDelivery.findFirst.mockResolvedValue(
      delivery({ attempts: 4 }),
    );
    fetchMock.mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => '',
    });

    await service.attempt('d1', tenantId);

    const data = prisma.webhookDelivery.update.mock.calls[0][0].data;
    expect(data.status).toBe('failed');
    expect(data.nextAttemptAt).toBeNull();
  });

  it('treats a network error like a failed response', async () => {
    prisma.webhookDelivery.findFirst.mockResolvedValue(delivery());
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));

    await service.attempt('d1', tenantId);

    expect(prisma.webhookDelivery.update.mock.calls[0][0].data.error).toContain(
      'ECONNREFUSED',
    );
  });

  it('switches a destination off once it has failed enough in a row', async () => {
    prisma.webhookDelivery.findFirst.mockResolvedValue(delivery());
    prisma.webhook.update.mockResolvedValue({
      consecutiveFailures: 15,
      isActive: true,
    });
    fetchMock.mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => '',
    });

    await service.attempt('d1', tenantId);

    const off = prisma.webhook.update.mock.calls[1][0].data;
    expect(off).toMatchObject({ isActive: false });
    expect(off.disabledReason).toContain('failed');
  });

  it('does not attempt a delivery that already succeeded', async () => {
    prisma.webhookDelivery.findFirst.mockResolvedValue(
      delivery({ status: 'delivered' }),
    );

    await service.attempt('d1', tenantId);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('replaying writes a new delivery rather than rewriting the old one', async () => {
    prisma.webhookDelivery.findFirst
      .mockResolvedValueOnce(delivery())
      .mockResolvedValue(delivery({ id: 'd-new' }));
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => '',
    });

    await service.replay(tenantId, 'd1');

    // What happened the first time is part of the record.
    expect(prisma.webhookDelivery.create).toHaveBeenCalled();
  });

  it('turning a destination back on clears the strikes against it', async () => {
    prisma.webhook.findFirst.mockResolvedValue({ id: 'w1' });

    await service.update(tenantId, 'w1', { isActive: true });

    expect(prisma.webhook.update.mock.calls[0][0].data).toMatchObject({
      consecutiveFailures: 0,
      disabledAt: null,
    });
  });

  it('a dispatch failure never escapes into the operation that caused it', async () => {
    prisma.webhook.findMany.mockRejectedValue(new Error('database is down'));

    await expect(
      service.onDomainEvent({
        tenantId,
        trigger: WorkflowTrigger.RECORD_CREATED,
        entity: 'deal',
        record: {},
      }),
    ).resolves.toBeUndefined();
  });
});
