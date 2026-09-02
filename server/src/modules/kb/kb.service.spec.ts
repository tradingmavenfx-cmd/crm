import { Test } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ArticleStatus, ArticleVisibility } from '@prisma/client';
import { KbService } from './kb.service';
import { PrismaService } from '../../prisma/prisma.service';

const article = (over: Record<string, unknown> = {}) => ({
  id: 'a1',
  tenantId: 'tenant-1',
  slug: 'refund-policy',
  title: 'Refund policy',
  excerpt: 'How refunds work',
  body: 'We process refunds within seven working days.',
  status: ArticleStatus.PUBLISHED,
  visibility: ArticleVisibility.PUBLIC,
  categoryId: null,
  tags: [] as string[],
  locale: 'en',
  translationOfId: null,
  version: 1,
  viewCount: 0,
  helpfulCount: 0,
  notHelpfulCount: 0,
  publishedAt: new Date(),
  updatedAt: new Date(),
  category: null,
  ...over,
});

describe('KbService', () => {
  let service: KbService;
  let prisma: any;
  const tenantId = 'tenant-1';

  beforeEach(async () => {
    prisma = {
      article: {
        findFirst: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest
          .fn()
          .mockImplementation(({ data }: any) =>
            Promise.resolve({ id: 'a1', ...data }),
          ),
        update: jest
          .fn()
          .mockImplementation(({ data }: any) =>
            Promise.resolve({ id: 'a1', ...data }),
          ),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        delete: jest.fn(),
      },
      articleCategory: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn(),
        delete: jest.fn(),
      },
      articleVersion: {
        findFirst: jest.fn(),
        upsert: jest.fn().mockResolvedValue({}),
      },
      articleFeedback: { create: jest.fn().mockResolvedValue({}) },
      kbSearch: {
        create: jest.fn().mockResolvedValue({}),
        findMany: jest.fn().mockResolvedValue([]),
      },
      ticket: { findFirst: jest.fn() },
      tenant: {
        findFirst: jest.fn().mockResolvedValue({ id: tenantId, name: 'Acme' }),
      },
    };

    const moduleRef = await Test.createTestingModule({
      providers: [KbService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = moduleRef.get(KbService);
  });

  // ── Slugs ──────────────────────────────────────

  it('derives a slug from the title', async () => {
    await service.createArticle(tenantId, 'u1', {
      title: 'How do I get a Refund?',
      body: 'x',
    });

    expect(prisma.article.create.mock.calls[0][0].data.slug).toBe(
      'how-do-i-get-a-refund',
    );
  });

  it('makes a clashing slug unique rather than failing', async () => {
    prisma.article.findFirst
      .mockResolvedValueOnce({ id: 'other' })
      .mockResolvedValueOnce(null);

    await service.createArticle(tenantId, 'u1', {
      title: 'Refund policy',
      body: 'x',
    });

    expect(prisma.article.create.mock.calls[0][0].data.slug).toBe(
      'refund-policy-2',
    );
  });

  it('refuses a translation in the same language as its source', async () => {
    prisma.article.findFirst
      .mockResolvedValueOnce(null) // slug check
      .mockResolvedValueOnce({ locale: 'en' }); // source article

    await expect(
      service.createArticle(tenantId, 'u1', {
        title: 'Refund policy',
        body: 'x',
        locale: 'en',
        translationOfId: 'a1',
      }),
    ).rejects.toThrow('different language');
  });

  // ── Relevance ──────────────────────────────────

  it('ranks a title match above a passing body mention', async () => {
    prisma.article.findMany.mockResolvedValue([
      article({
        id: 'passing',
        title: 'Shipping times',
        excerpt: null,
        body: 'If you need a refund, contact us.',
      }),
      article({ id: 'onTopic', title: 'Refund policy' }),
    ]);

    const result = await service.publicSearch(tenantId, { q: 'refund' });

    expect(result.results[0].title).toBe('Refund policy');
    expect(result.results).toHaveLength(2);
  });

  it('ignores stop words so a question still matches', async () => {
    prisma.article.findMany.mockResolvedValue([
      article({ title: 'Refund policy' }),
    ]);

    const result = await service.publicSearch(tenantId, {
      q: 'How can I get my refund?',
    });

    expect(result.results).toHaveLength(1);
  });

  it('returns nothing rather than everything when nothing matches', async () => {
    prisma.article.findMany.mockResolvedValue([article()]);

    const result = await service.publicSearch(tenantId, {
      q: 'quantum physics',
    });

    expect(result.results).toHaveLength(0);
  });

  it('lets a well-rated article edge ahead of an equal one', async () => {
    prisma.article.findMany.mockResolvedValue([
      article({ id: 'unrated', title: 'Refund policy', slug: 'a' }),
      article({
        id: 'rated',
        title: 'Refund policy',
        slug: 'b',
        helpfulCount: 9,
        notHelpfulCount: 1,
      }),
    ]);

    const result = await service.publicSearch(tenantId, { q: 'refund' });

    expect(result.results[0].slug).toBe('b');
  });

  // ── Public visibility ──────────────────────────

  it('the help centre only ever queries published, public articles', async () => {
    await service.publicSearch(tenantId, {});

    expect(prisma.article.findMany.mock.calls[0][0].where).toMatchObject({
      status: ArticleStatus.PUBLISHED,
      visibility: ArticleVisibility.PUBLIC,
    });
  });

  it('a missing help centre 404s rather than leaking an empty one', async () => {
    prisma.tenant.findFirst.mockResolvedValue(null);

    await expect(service.publicSearch('nope', {})).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('counts a view when a public article is read', async () => {
    prisma.article.findFirst.mockResolvedValue(
      article({ tenant: { name: 'Acme' }, translations: [] }),
    );

    await service.publicArticle(tenantId, 'refund-policy');

    expect(prisma.article.update).toHaveBeenCalledWith({
      where: { id: 'a1' },
      data: { viewCount: { increment: 1 } },
    });
  });

  it('a translation links back to the article it came from', async () => {
    prisma.article.findFirst.mockResolvedValue(
      article({
        locale: 'hi',
        slug: 'refund-policy-hi',
        tenant: { name: 'Acme' },
        translations: [],
        translationOf: {
          slug: 'refund-policy',
          locale: 'en',
          title: 'Refund policy',
          status: ArticleStatus.PUBLISHED,
          visibility: ArticleVisibility.PUBLIC,
        },
      }),
    );

    const view = await service.publicArticle(
      tenantId,
      'refund-policy-hi',
      'hi',
    );

    expect(view.translations).toEqual([
      { slug: 'refund-policy', locale: 'en', title: 'Refund policy' },
    ]);
  });

  it('does not offer a source article that is not itself public', async () => {
    prisma.article.findFirst.mockResolvedValue(
      article({
        locale: 'hi',
        tenant: { name: 'Acme' },
        translations: [],
        translationOf: {
          slug: 'refund-policy',
          locale: 'en',
          title: 'Refund policy',
          status: ArticleStatus.DRAFT,
          visibility: ArticleVisibility.PUBLIC,
        },
      }),
    );

    const view = await service.publicArticle(
      tenantId,
      'refund-policy-hi',
      'hi',
    );

    expect(view.translations).toHaveLength(0);
  });

  it('does not expose the article id or status publicly', async () => {
    prisma.article.findFirst.mockResolvedValue(
      article({ tenant: { name: 'Acme' }, translations: [] }),
    );

    const view = await service.publicArticle(tenantId, 'refund-policy');

    expect(view).not.toHaveProperty('id');
    expect(view).not.toHaveProperty('status');
  });

  // ── Versioning ─────────────────────────────────

  it('publishing snapshots the current text as a version', async () => {
    prisma.article.findFirst.mockResolvedValue(
      article({ status: ArticleStatus.DRAFT, version: 1, publishedAt: null }),
    );

    await service.publishArticle(tenantId, 'a1', 'u1', 'First cut');

    const snapshot = prisma.articleVersion.upsert.mock.calls[0][0];
    expect(snapshot.create).toMatchObject({
      version: 1,
      title: 'Refund policy',
      note: 'First cut',
    });
  });

  it('republishing bumps the version rather than overwriting history', async () => {
    prisma.article.findFirst.mockResolvedValue(
      article({ status: ArticleStatus.PUBLISHED, version: 3 }),
    );

    await service.publishArticle(tenantId, 'a1', 'u1');

    expect(prisma.articleVersion.upsert.mock.calls[0][0].create.version).toBe(
      4,
    );
    expect(prisma.article.update.mock.calls[0][0].data.version).toBe(4);
  });

  it('bumps the version even after an edit left the row mid-rewrite', async () => {
    // Version used to key off status, so an edited article republished over
    // its own v1 and lost the previous text.
    prisma.article.findFirst.mockResolvedValue(
      article({
        status: ArticleStatus.PUBLISHED,
        version: 1,
        publishedAt: new Date('2026-01-01'),
        title: 'Refund policy (rewritten)',
      }),
    );

    await service.publishArticle(tenantId, 'a1', 'u1');

    expect(prisma.articleVersion.upsert.mock.calls[0][0].create.version).toBe(
      2,
    );
  });

  it('a first publish is version 1, not 2', async () => {
    prisma.article.findFirst.mockResolvedValue(
      article({ status: ArticleStatus.DRAFT, version: 1, publishedAt: null }),
    );

    await service.publishArticle(tenantId, 'a1', 'u1');

    expect(prisma.articleVersion.upsert.mock.calls[0][0].create.version).toBe(
      1,
    );
  });

  it('keeps the original publish date on a republish', async () => {
    const first = new Date('2026-01-01');
    prisma.article.findFirst.mockResolvedValue(
      article({ status: ArticleStatus.PUBLISHED, publishedAt: first }),
    );

    await service.publishArticle(tenantId, 'a1', 'u1');

    expect(prisma.article.update.mock.calls[0][0].data.publishedAt).toBe(first);
  });

  it('editing a published article never takes it offline', async () => {
    prisma.article.findFirst.mockResolvedValue(
      article({ status: ArticleStatus.PUBLISHED }),
    );

    await service.updateArticle(tenantId, 'a1', 'u1', { body: 'New text' });

    // Dropping to draft on edit used to 404 the live article the moment
    // someone started rewriting it.
    expect(prisma.article.update.mock.calls[0][0].data.status).toBeUndefined();
  });

  it('the help centre serves the published snapshot, not the edited row', async () => {
    prisma.article.findFirst.mockResolvedValue(
      article({
        version: 2,
        title: 'Half-finished rewrite',
        body: 'draft text nobody should see',
        tenant: { name: 'Acme' },
        translations: [],
      }),
    );
    prisma.articleVersion.findFirst.mockResolvedValue({
      title: 'Refund policy',
      body: 'We process refunds within seven working days.',
    });

    const view = await service.publicArticle(tenantId, 'refund-policy');

    expect(view.title).toBe('Refund policy');
    expect(view.body).not.toContain('draft text');
  });

  it('falls back to the row when no snapshot exists', async () => {
    prisma.article.findFirst.mockResolvedValue(
      article({ tenant: { name: 'Acme' }, translations: [] }),
    );
    prisma.articleVersion.findFirst.mockResolvedValue(null);

    const view = await service.publicArticle(tenantId, 'refund-policy');

    expect(view.title).toBe('Refund policy');
  });

  it('flags an article whose working copy has moved on from what is live', async () => {
    prisma.articleVersion.findFirst.mockResolvedValue({
      title: 'Refund policy',
      body: 'Original text',
    });

    const changed = await service.hasUnpublishedChanges(
      article({ body: 'Rewritten text' }) as never,
    );
    expect(changed).toBe(true);

    const same = await service.hasUnpublishedChanges(
      article({ title: 'Refund policy', body: 'Original text' }) as never,
    );
    expect(same).toBe(false);
  });

  it('restoring an old version changes the working copy, not what is live', async () => {
    prisma.article.findFirst.mockResolvedValue(article());
    prisma.articleVersion.findFirst.mockResolvedValue({
      version: 2,
      title: 'Refund policy (v2)',
      body: 'Older wording',
    });

    await service.restoreVersion(tenantId, 'a1', 2);

    const data = prisma.article.update.mock.calls[0][0].data;
    expect(data).toMatchObject({
      title: 'Refund policy (v2)',
      body: 'Older wording',
    });
    expect(data.status).toBeUndefined();
  });

  it('rejects restoring a version that does not exist', async () => {
    prisma.article.findFirst.mockResolvedValue(article());
    prisma.articleVersion.findFirst.mockResolvedValue(null);

    await expect(service.restoreVersion(tenantId, 'a1', 99)).rejects.toThrow(
      'Version 99 not found',
    );
  });

  // ── Feedback ───────────────────────────────────

  it('records helpful feedback against the article', async () => {
    prisma.article.findFirst.mockResolvedValue({ id: 'a1' });

    await service.submitFeedback(tenantId, 'refund-policy', 'en', {
      helpful: true,
    });

    expect(prisma.article.update).toHaveBeenCalledWith({
      where: { id: 'a1' },
      data: { helpfulCount: { increment: 1 } },
    });
  });

  it('records unhelpful feedback on the other counter', async () => {
    prisma.article.findFirst.mockResolvedValue({ id: 'a1' });

    await service.submitFeedback(tenantId, 'refund-policy', 'en', {
      helpful: false,
      comment: 'Did not answer my case',
    });

    expect(prisma.article.update).toHaveBeenCalledWith({
      where: { id: 'a1' },
      data: { notHelpfulCount: { increment: 1 } },
    });
  });

  // ── Suggestions ────────────────────────────────

  it('suggests articles for a ticket, best match first', async () => {
    prisma.ticket.findFirst.mockResolvedValue({
      subject: 'I want a refund for my order',
      description: null,
      category: 'Billing',
    });
    prisma.article.findMany.mockResolvedValue([
      article({ id: 'off', title: 'Shipping times', excerpt: null, body: 'x' }),
      article({ id: 'on', title: 'Refund policy' }),
    ]);

    const suggestions = await service.suggestForTicket(tenantId, 't1');

    expect(suggestions[0].title).toBe('Refund policy');
    expect(suggestions.every((s) => s.score > 0)).toBe(true);
  });

  it('suggests internal articles too - the agent may read them', async () => {
    prisma.ticket.findFirst.mockResolvedValue({
      subject: 'refund',
      description: null,
      category: null,
    });
    prisma.article.findMany.mockResolvedValue([
      article({
        visibility: ArticleVisibility.INTERNAL,
        title: 'Refund runbook',
      }),
    ]);

    const suggestions = await service.suggestForTicket(tenantId, 't1');

    expect(suggestions[0].visibility).toBe(ArticleVisibility.INTERNAL);
    // Only published articles are considered.
    expect(prisma.article.findMany.mock.calls[0][0].where).toMatchObject({
      status: ArticleStatus.PUBLISHED,
    });
  });

  // ── Search analytics ───────────────────────────

  it('surfaces the searches that found nothing as gaps', async () => {
    prisma.kbSearch.findMany.mockResolvedValue([
      { query: 'GST invoice', resultCount: 0, source: 'public' },
      { query: 'gst invoice', resultCount: 0, source: 'public' },
      { query: 'refund', resultCount: 3, source: 'public' },
    ]);

    const analytics = await service.searchAnalytics(tenantId);

    expect(analytics).toMatchObject({
      totalSearches: 3,
      noResults: 2,
      noResultRate: 67,
    });
    // Case-insensitive tally, so the same question counts once.
    expect(analytics.gaps[0]).toEqual({
      query: 'gst invoice',
      searches: 2,
      misses: 2,
    });
  });

  it('a search that cannot be logged still returns its results', async () => {
    prisma.kbSearch.create.mockRejectedValue(new Error('db down'));
    prisma.article.findMany.mockResolvedValue([
      article({ title: 'Refund policy' }),
    ]);

    const result = await service.publicSearch(tenantId, { q: 'refund' });

    expect(result.results).toHaveLength(1);
  });

  // ── Housekeeping ───────────────────────────────

  it('deleting a category leaves its articles uncategorised', async () => {
    prisma.articleCategory.findFirst.mockResolvedValue({ id: 'cat1' });

    await service.removeCategory(tenantId, 'cat1');

    expect(prisma.article.updateMany).toHaveBeenCalledWith({
      where: { tenantId, categoryId: 'cat1' },
      data: { categoryId: null },
    });
    expect(prisma.articleCategory.delete).toHaveBeenCalled();
  });

  it('refuses a duplicate category name', async () => {
    prisma.articleCategory.findFirst.mockResolvedValue({ id: 'existing' });

    await expect(
      service.createCategory(tenantId, { name: 'Billing' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('scopes article lookups to the tenant', async () => {
    prisma.article.findFirst.mockResolvedValue(null);
    await expect(service.getArticle(tenantId, 'other')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
