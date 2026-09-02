import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { KbService } from './kb.service';
import {
  ArticleFeedbackDto,
  CreateArticleDto,
  CreateCategoryDto,
  PublicSearchDto,
  QueryArticlesDto,
  RestoreVersionDto,
  UpdateArticleDto,
} from './dto/kb.dto';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';

@Controller()
export class KbController {
  constructor(private readonly kb: KbService) {}

  // ── Categories ───────────────────────────────

  @Get('kb/categories')
  listCategories(@CurrentUser('tenantId') tenantId: string) {
    return this.kb.listCategories(tenantId);
  }

  @Post('kb/categories')
  @Roles(Role.TENANT_ADMIN, Role.MANAGER, Role.SUPPORT_AGENT)
  createCategory(
    @CurrentUser('tenantId') tenantId: string,
    @Body() dto: CreateCategoryDto,
  ) {
    return this.kb.createCategory(tenantId, dto);
  }

  @Delete('kb/categories/:id')
  @Roles(Role.TENANT_ADMIN, Role.MANAGER)
  removeCategory(
    @CurrentUser('tenantId') tenantId: string,
    @Param('id') id: string,
  ) {
    return this.kb.removeCategory(tenantId, id);
  }

  // ── Analytics (before :id so it is not shadowed) ──

  @Get('kb/search-analytics')
  searchAnalytics(
    @CurrentUser('tenantId') tenantId: string,
    @Query('days') days?: string,
  ) {
    return this.kb.searchAnalytics(tenantId, days ? Number(days) : 30);
  }

  @Get('kb/stats')
  stats(@CurrentUser('tenantId') tenantId: string) {
    return this.kb.articleStats(tenantId);
  }

  /** Articles worth sending on a ticket. */
  @Get('kb/suggest/ticket/:ticketId')
  suggest(
    @CurrentUser('tenantId') tenantId: string,
    @Param('ticketId') ticketId: string,
  ) {
    return this.kb.suggestForTicket(tenantId, ticketId);
  }

  // ── Articles ─────────────────────────────────

  @Get('kb/articles')
  listArticles(
    @CurrentUser('tenantId') tenantId: string,
    @CurrentUser('userId') userId: string,
    @Query() query: QueryArticlesDto,
  ) {
    return this.kb.listArticles(tenantId, query, userId);
  }

  @Get('kb/articles/:id')
  getArticle(
    @CurrentUser('tenantId') tenantId: string,
    @Param('id') id: string,
  ) {
    return this.kb.getArticle(tenantId, id);
  }

  @Post('kb/articles')
  @Roles(Role.TENANT_ADMIN, Role.MANAGER, Role.SUPPORT_AGENT)
  createArticle(
    @CurrentUser('tenantId') tenantId: string,
    @CurrentUser('userId') userId: string,
    @Body() dto: CreateArticleDto,
  ) {
    return this.kb.createArticle(tenantId, userId, dto);
  }

  @Patch('kb/articles/:id')
  @Roles(Role.TENANT_ADMIN, Role.MANAGER, Role.SUPPORT_AGENT)
  updateArticle(
    @CurrentUser('tenantId') tenantId: string,
    @CurrentUser('userId') userId: string,
    @Param('id') id: string,
    @Body() dto: UpdateArticleDto,
  ) {
    return this.kb.updateArticle(tenantId, id, userId, dto);
  }

  @Post('kb/articles/:id/publish')
  @Roles(Role.TENANT_ADMIN, Role.MANAGER, Role.SUPPORT_AGENT)
  publish(
    @CurrentUser('tenantId') tenantId: string,
    @CurrentUser('userId') userId: string,
    @Param('id') id: string,
    @Body() dto: { note?: string },
  ) {
    return this.kb.publishArticle(tenantId, id, userId, dto?.note);
  }

  @Post('kb/articles/:id/archive')
  @Roles(Role.TENANT_ADMIN, Role.MANAGER, Role.SUPPORT_AGENT)
  archive(@CurrentUser('tenantId') tenantId: string, @Param('id') id: string) {
    return this.kb.archiveArticle(tenantId, id);
  }

  @Post('kb/articles/:id/restore')
  @Roles(Role.TENANT_ADMIN, Role.MANAGER, Role.SUPPORT_AGENT)
  restore(
    @CurrentUser('tenantId') tenantId: string,
    @Param('id') id: string,
    @Body() dto: RestoreVersionDto,
  ) {
    return this.kb.restoreVersion(tenantId, id, dto.version);
  }

  @Delete('kb/articles/:id')
  @Roles(Role.TENANT_ADMIN, Role.MANAGER)
  removeArticle(
    @CurrentUser('tenantId') tenantId: string,
    @Param('id') id: string,
  ) {
    return this.kb.removeArticle(tenantId, id);
  }

  // ── Help centre (public) ─────────────────────

  @Public()
  @Get('help/:tenantId')
  helpCentre(
    @Param('tenantId') tenantId: string,
    @Query() query: PublicSearchDto,
  ) {
    return this.kb.publicSearch(tenantId, query);
  }

  @Public()
  @Get('help/:tenantId/:slug')
  helpArticle(
    @Param('tenantId') tenantId: string,
    @Param('slug') slug: string,
    @Query('locale') locale?: string,
  ) {
    return this.kb.publicArticle(tenantId, slug, locale ?? 'en');
  }

  @Public()
  @Post('help/:tenantId/:slug/feedback')
  feedback(
    @Param('tenantId') tenantId: string,
    @Param('slug') slug: string,
    @Body() dto: ArticleFeedbackDto,
    @Query('locale') locale?: string,
  ) {
    return this.kb.submitFeedback(tenantId, slug, locale ?? 'en', dto);
  }
}
