import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  Article,
  ArticleStatus,
  ArticleVisibility,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  ArticleFeedbackDto,
  CreateArticleDto,
  CreateCategoryDto,
  PublicSearchDto,
  QueryArticlesDto,
  UpdateArticleDto,
} from './dto/kb.dto';

/** Words too common to say anything about relevance. */
const STOP_WORDS = new Set([
  'the',
  'and',
  'for',
  'you',
  'your',
  'with',
  'this',
  'that',
  'from',
  'have',
  'how',
  'can',
  'not',
  'are',
  'was',
  'but',
  'has',
  'our',
  'get',
  'does',
  'did',
  'when',
  'what',
  'why',
  'who',
  'will',
  'would',
  'please',
  'help',
  'need',
]);

@Injectable()
export class KbService {
  private readonly logger = new Logger('KbService');

  constructor(private readonly prisma: PrismaService) {}

  // ── Helpers ──────────────────────────────────

  private slugify(title: string): string {
    return (
      title
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 80) || 'article'
    );
  }

  /** Meaningful words from a query, for relevance scoring. */
  private terms(text: string): string[] {
    return [
      ...new Set(
        text
          .toLowerCase()
          .split(/[^a-z0-9]+/)
          .filter((w) => w.length > 2 && !STOP_WORDS.has(w)),
      ),
    ];
  }

  /**
   * Relevance for one article against a set of query terms.
   *
   * Deliberately transparent rather than a black box: a title hit is worth
   * more than a body hit, so "Refund policy" beats an article that mentions
   * refunds once in passing, and an editor can see why an article ranks where
   * it does.
   */
  private score(article: Article, terms: string[]): number {
    if (!terms.length) return 0;

    const title = article.title.toLowerCase();
    const excerpt = (article.excerpt ?? '').toLowerCase();
    const body = article.body.toLowerCase();
    const tags = article.tags.map((t) => t.toLowerCase());

    let score = 0;
    for (const term of terms) {
      if (title.includes(term)) score += 10;
      if (tags.some((t) => t.includes(term))) score += 6;
      if (excerpt.includes(term)) score += 3;
      if (body.includes(term)) score += 1;
    }

    // A well-rated article is more likely to be the one worth sending.
    const votes = article.helpfulCount + article.notHelpfulCount;
    if (votes >= 3) {
      score += Math.round((article.helpfulCount / votes) * 4);
    }
    return score;
  }

  private async uniqueSlug(
    tenantId: string,
    locale: string,
    desired: string,
    exceptId?: string,
  ): Promise<string> {
    let slug = desired;
    let suffix = 1;
    for (;;) {
      const clash = await this.prisma.article.findFirst({
        where: {
          tenantId,
          locale,
          slug,
          ...(exceptId ? { id: { not: exceptId } } : {}),
        },
        select: { id: true },
      });
      if (!clash) return slug;
      slug = `${desired}-${++suffix}`;
    }
  }

  private recordSearch(
    tenantId: string,
    query: string,
    resultCount: number,
    source: 'public' | 'agent',
    userId?: string,
  ) {
    // Search logging is analytics, never a reason to fail the search itself.
    return this.prisma.kbSearch
      .create({ data: { tenantId, query, resultCount, source, userId } })
      .catch((err: Error) =>
        this.logger.warn(`Could not record search: ${err.message}`),
      );
  }

  // ── Categories ───────────────────────────────

  listCategories(tenantId: string) {
    return this.prisma.articleCategory.findMany({
      where: { tenantId },
      orderBy: [{ position: 'asc' }, { name: 'asc' }],
      include: { _count: { select: { articles: true } } },
    });
  }

  async createCategory(tenantId: string, dto: CreateCategoryDto) {
    const slug = this.slugify(dto.name);
    const clash = await this.prisma.articleCategory.findFirst({
      where: { tenantId, slug },
    });
    if (clash) {
      throw new BadRequestException(`A category "${dto.name}" already exists`);
    }

    return this.prisma.articleCategory.create({
      data: {
        tenantId,
        name: dto.name,
        slug,
        description: dto.description,
        position: dto.position ?? 0,
      },
    });
  }

  async removeCategory(tenantId: string, id: string) {
    const category = await this.prisma.articleCategory.findFirst({
      where: { id, tenantId },
    });
    if (!category) throw new NotFoundException('Category not found');

    // Articles outlive their category; they simply become uncategorised.
    await this.prisma.article.updateMany({
      where: { tenantId, categoryId: id },
      data: { categoryId: null },
    });
    await this.prisma.articleCategory.delete({ where: { id } });
    return { success: true };
  }

  // ── Articles (agent side) ────────────────────

  async listArticles(
    tenantId: string,
    query: QueryArticlesDto,
    userId?: string,
  ) {
    const where: Prisma.ArticleWhereInput = { tenantId };
    if (query.status) where.status = query.status;
    if (query.visibility) where.visibility = query.visibility;
    if (query.categoryId) where.categoryId = query.categoryId;
    if (query.locale) where.locale = query.locale;

    const articles = await this.prisma.article.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      include: {
        category: { select: { id: true, name: true } },
        author: { select: { id: true, firstName: true, lastName: true } },
        _count: { select: { versions: true, translations: true } },
      },
    });

    if (!query.search) return articles;

    const terms = this.terms(query.search);
    const ranked = articles
      .map((a) => ({ article: a, score: this.score(a, terms) }))
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score)
      .map((r) => r.article);

    await this.recordSearch(
      tenantId,
      query.search,
      ranked.length,
      'agent',
      userId,
    );
    return ranked;
  }

  async getArticle(tenantId: string, id: string) {
    const article = await this.prisma.article.findFirst({
      where: { id, tenantId },
      include: {
        category: { select: { id: true, name: true } },
        author: { select: { id: true, firstName: true, lastName: true } },
        versions: {
          orderBy: { version: 'desc' },
          select: {
            id: true,
            version: true,
            title: true,
            note: true,
            createdAt: true,
          },
        },
        translations: {
          select: { id: true, locale: true, title: true, status: true },
        },
        translationOf: { select: { id: true, locale: true, title: true } },
        feedback: {
          orderBy: { createdAt: 'desc' },
          take: 20,
          select: { helpful: true, comment: true, createdAt: true },
        },
      },
    });
    if (!article) throw new NotFoundException('Article not found');

    return {
      ...article,
      unpublishedChanges: await this.hasUnpublishedChanges(article),
    };
  }

  async createArticle(tenantId: string, userId: string, dto: CreateArticleDto) {
    const locale = dto.locale ?? 'en';
    const slug = await this.uniqueSlug(
      tenantId,
      locale,
      dto.slug ?? this.slugify(dto.title),
    );

    if (dto.translationOfId) {
      const source = await this.prisma.article.findFirst({
        where: { id: dto.translationOfId, tenantId },
        select: { locale: true },
      });
      if (!source) throw new NotFoundException('Source article not found');
      if (source.locale === locale) {
        throw new BadRequestException(
          'A translation must be in a different language from its source',
        );
      }
    }

    return this.prisma.article.create({
      data: {
        tenantId,
        slug,
        title: dto.title,
        excerpt: dto.excerpt,
        body: dto.body,
        visibility: dto.visibility ?? ArticleVisibility.PUBLIC,
        categoryId: dto.categoryId,
        tags: dto.tags ?? [],
        locale,
        translationOfId: dto.translationOfId,
        authorId: userId,
      },
    });
  }

  /**
   * Edits the working copy.
   *
   * The status is deliberately untouched: the help centre serves the latest
   * published *version*, not this row, so an editor part-way through a rewrite
   * never takes live content offline. The change goes out only on publish.
   */
  async updateArticle(
    tenantId: string,
    id: string,
    userId: string,
    dto: UpdateArticleDto,
  ) {
    await this.getArticle(tenantId, id);

    return this.prisma.article.update({
      where: { id },
      data: {
        title: dto.title,
        excerpt: dto.excerpt,
        body: dto.body,
        visibility: dto.visibility,
        categoryId: dto.categoryId,
        tags: dto.tags,
        authorId: userId,
      },
    });
  }

  /** Publishes the current text and snapshots it as a version. */
  async publishArticle(
    tenantId: string,
    id: string,
    userId: string,
    note?: string,
  ) {
    const article = await this.getArticle(tenantId, id);

    // Keyed off whether it has ever been published, not its current status:
    // keying off status meant an edited article republished over its own v1
    // and lost the previous text.
    const version = article.publishedAt ? article.version + 1 : 1;

    await this.prisma.articleVersion.upsert({
      where: { articleId_version: { articleId: id, version } },
      update: {
        title: article.title,
        body: article.body,
        note,
        authorId: userId,
      },
      create: {
        tenantId,
        articleId: id,
        version,
        title: article.title,
        body: article.body,
        note,
        authorId: userId,
      },
    });

    return this.prisma.article.update({
      where: { id },
      data: {
        status: ArticleStatus.PUBLISHED,
        version,
        publishedAt: article.publishedAt ?? new Date(),
      },
    });
  }

  async archiveArticle(tenantId: string, id: string) {
    await this.getArticle(tenantId, id);
    return this.prisma.article.update({
      where: { id },
      data: { status: ArticleStatus.ARCHIVED },
    });
  }

  /** Brings an older version's text back as the working copy. */
  async restoreVersion(tenantId: string, id: string, version: number) {
    await this.getArticle(tenantId, id);
    const snapshot = await this.prisma.articleVersion.findFirst({
      where: { tenantId, articleId: id, version },
    });
    if (!snapshot) throw new NotFoundException(`Version ${version} not found`);

    // Restoring changes the working copy only; the live text stays as it is
    // until this is published, exactly like any other edit.
    return this.prisma.article.update({
      where: { id },
      data: { title: snapshot.title, body: snapshot.body },
    });
  }

  async removeArticle(tenantId: string, id: string) {
    await this.getArticle(tenantId, id);
    await this.prisma.article.delete({ where: { id } });
    return { success: true };
  }

  // ── Help centre (public) ─────────────────────

  /** Published, public articles only - internal ones never leave the CRM. */
  async publicSearch(tenantId: string, query: PublicSearchDto) {
    const tenant = await this.prisma.tenant.findFirst({
      where: { id: tenantId, isActive: true },
      select: { id: true, name: true },
    });
    if (!tenant) throw new NotFoundException('Help centre not found');

    const articles = await this.prisma.article.findMany({
      where: {
        tenantId,
        status: ArticleStatus.PUBLISHED,
        visibility: ArticleVisibility.PUBLIC,
        ...(query.locale ? { locale: query.locale } : {}),
        ...(query.categoryId ? { categoryId: query.categoryId } : {}),
      },
      include: { category: { select: { id: true, name: true } } },
    });

    const shape = (a: (typeof articles)[number]) => ({
      slug: a.slug,
      title: a.title,
      excerpt: a.excerpt,
      locale: a.locale,
      tags: a.tags,
      category: a.category,
      helpfulCount: a.helpfulCount,
    });

    if (!query.q) {
      return {
        tenant: { name: tenant.name },
        query: null,
        results: articles
          .sort((a, b) => b.helpfulCount - a.helpfulCount)
          .map(shape),
      };
    }

    const terms = this.terms(query.q);
    const ranked = articles
      .map((a) => ({ a, score: this.score(a, terms) }))
      .filter((r) => r.score > 0)
      .sort((x, y) => y.score - x.score);

    // Logged whether or not it matched: the misses are what show the gaps.
    await this.recordSearch(tenantId, query.q, ranked.length, 'public');

    return {
      tenant: { name: tenant.name },
      query: query.q,
      results: ranked.map((r) => shape(r.a)),
    };
  }

  async publicArticle(tenantId: string, slug: string, locale = 'en') {
    const article = await this.prisma.article.findFirst({
      where: {
        tenantId,
        slug,
        locale,
        status: ArticleStatus.PUBLISHED,
        visibility: ArticleVisibility.PUBLIC,
      },
      include: {
        category: { select: { id: true, name: true } },
        tenant: { select: { name: true } },
        translations: {
          where: {
            status: ArticleStatus.PUBLISHED,
            visibility: ArticleVisibility.PUBLIC,
          },
          select: { slug: true, locale: true, title: true },
        },
        // So a translation can link back to the article it came from.
        translationOf: {
          select: {
            slug: true,
            locale: true,
            title: true,
            status: true,
            visibility: true,
          },
        },
      },
    });
    if (!article) throw new NotFoundException('Article not found');

    // Serve the published snapshot, not the working row, so an edit in
    // progress is never visible to customers.
    const live = await this.publishedText(article);

    await this.prisma.article.update({
      where: { id: article.id },
      data: { viewCount: { increment: 1 } },
    });

    return {
      slug: article.slug,
      title: live.title,
      excerpt: article.excerpt,
      body: live.body,
      locale: article.locale,
      tags: article.tags,
      category: article.category,
      tenant: article.tenant,
      // Every other language this article is available in: its siblings if it
      // is the source, or the source plus nothing else if it is a translation.
      translations: [
        ...(article.translationOf &&
        article.translationOf.status === ArticleStatus.PUBLISHED &&
        article.translationOf.visibility === ArticleVisibility.PUBLIC
          ? [
              {
                slug: article.translationOf.slug,
                locale: article.translationOf.locale,
                title: article.translationOf.title,
              },
            ]
          : []),
        ...article.translations,
      ],
      helpfulCount: article.helpfulCount,
      notHelpfulCount: article.notHelpfulCount,
      updatedAt: article.updatedAt,
    };
  }

  async submitFeedback(
    tenantId: string,
    slug: string,
    locale: string,
    dto: ArticleFeedbackDto,
  ) {
    const article = await this.prisma.article.findFirst({
      where: {
        tenantId,
        slug,
        locale,
        status: ArticleStatus.PUBLISHED,
        visibility: ArticleVisibility.PUBLIC,
      },
      select: { id: true },
    });
    if (!article) throw new NotFoundException('Article not found');

    await this.prisma.articleFeedback.create({
      data: {
        tenantId,
        articleId: article.id,
        helpful: dto.helpful,
        comment: dto.comment,
      },
    });

    await this.prisma.article.update({
      where: { id: article.id },
      data: dto.helpful
        ? { helpfulCount: { increment: 1 } }
        : { notHelpfulCount: { increment: 1 } },
    });

    return { recorded: true };
  }

  /**
   * The text as last published. Falls back to the row for an article whose
   * snapshot is missing, so a seeded or imported article still renders.
   */
  private async publishedText(article: {
    id: string;
    version: number;
    title: string;
    body: string;
  }): Promise<{ title: string; body: string }> {
    const snapshot = await this.prisma.articleVersion.findFirst({
      where: { articleId: article.id, version: article.version },
      select: { title: true, body: true },
    });
    return snapshot ?? { title: article.title, body: article.body };
  }

  /** True when the working copy has moved on from what is live. */
  async hasUnpublishedChanges(article: {
    id: string;
    version: number;
    title: string;
    body: string;
    status: ArticleStatus;
  }): Promise<boolean> {
    if (article.status !== ArticleStatus.PUBLISHED) return false;
    const live = await this.publishedText(article);
    return live.title !== article.title || live.body !== article.body;
  }

  // ── Suggestions ──────────────────────────────

  /**
   * Articles worth sending on a ticket, ranked by the same transparent
   * relevance the search uses. Internal articles are included - an agent may
   * read them even though the customer may not.
   */
  async suggestForTicket(tenantId: string, ticketId: string) {
    const ticket = await this.prisma.ticket.findFirst({
      where: { id: ticketId, tenantId },
      select: { subject: true, description: true, category: true },
    });
    if (!ticket) throw new NotFoundException('Ticket not found');

    const articles = await this.prisma.article.findMany({
      where: { tenantId, status: ArticleStatus.PUBLISHED },
      include: { category: { select: { id: true, name: true } } },
    });

    const terms = this.terms(
      `${ticket.subject} ${ticket.description ?? ''} ${ticket.category ?? ''}`,
    );

    return articles
      .map((a) => ({
        id: a.id,
        slug: a.slug,
        title: a.title,
        excerpt: a.excerpt,
        visibility: a.visibility,
        category: a.category,
        score: this.score(a, terms),
      }))
      .filter((a) => a.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);
  }

  // ── Search analytics ─────────────────────────

  /** What people looked for, and what the knowledge base did not answer. */
  async searchAnalytics(tenantId: string, days = 30) {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const searches = await this.prisma.kbSearch.findMany({
      where: { tenantId, createdAt: { gte: since } },
      select: { query: true, resultCount: true, source: true },
    });

    const tally = new Map<
      string,
      { query: string; searches: number; misses: number }
    >();
    for (const search of searches) {
      const key = search.query.trim().toLowerCase();
      const row = tally.get(key) ?? { query: key, searches: 0, misses: 0 };
      row.searches += 1;
      if (search.resultCount === 0) row.misses += 1;
      tally.set(key, row);
    }

    const rows = [...tally.values()].sort((a, b) => b.searches - a.searches);
    const misses = searches.filter((s) => s.resultCount === 0).length;

    return {
      totalSearches: searches.length,
      noResults: misses,
      noResultRate: searches.length
        ? Math.round((misses / searches.length) * 100)
        : 0,
      topQueries: rows.slice(0, 20),
      // The gaps worth writing an article about.
      gaps: rows.filter((r) => r.misses > 0).slice(0, 20),
    };
  }

  /** How the published articles are performing. */
  async articleStats(tenantId: string) {
    const articles = await this.prisma.article.findMany({
      where: { tenantId },
      select: {
        title: true,
        slug: true,
        status: true,
        visibility: true,
        viewCount: true,
        helpfulCount: true,
        notHelpfulCount: true,
      },
    });

    const published = articles.filter((a) => a.status === 'PUBLISHED');

    return {
      total: articles.length,
      published: published.length,
      drafts: articles.filter((a) => a.status === 'DRAFT').length,
      internal: articles.filter((a) => a.visibility === 'INTERNAL').length,
      totalViews: articles.reduce((sum, a) => sum + a.viewCount, 0),
      mostViewed: [...published]
        .sort((a, b) => b.viewCount - a.viewCount)
        .slice(0, 10)
        .map((a) => ({ title: a.title, slug: a.slug, views: a.viewCount })),
      // Read a lot but voted down: the articles that need a rewrite.
      needsWork: published
        .filter((a) => a.notHelpfulCount > a.helpfulCount)
        .map((a) => ({
          title: a.title,
          slug: a.slug,
          helpful: a.helpfulCount,
          notHelpful: a.notHelpfulCount,
        })),
    };
  }
}
