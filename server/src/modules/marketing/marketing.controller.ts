import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { LeadsService } from './leads.service';
import { PagesService } from './pages.service';
import { AttributionService } from './attribution.service';
import {
  AttributionQueryDto,
  CaptureLeadDto,
  ConvertLeadDto,
  CreateFormDto,
  CreateLeadDto,
  CreatePageDto,
  QueryLeadsDto,
  SubmitFormDto,
  UpdateFormDto,
  UpdateLeadDto,
  UpdatePageDto,
} from './dto/marketing.dto';

@ApiTags('marketing')
@Controller()
export class MarketingController {
  constructor(
    private readonly leads: LeadsService,
    private readonly pages: PagesService,
    private readonly attribution: AttributionService,
  ) {}

  // ── Leads ────────────────────────────────────

  @Get('leads')
  listLeads(
    @CurrentUser('tenantId') tenantId: string,
    @Query() query: QueryLeadsDto,
  ) {
    return this.leads.list(tenantId, query);
  }

  @Get('leads/:id')
  getLead(@CurrentUser('tenantId') tenantId: string, @Param('id') id: string) {
    return this.leads.get(tenantId, id);
  }

  @Post('leads')
  createLead(
    @CurrentUser('tenantId') tenantId: string,
    @Body() dto: CreateLeadDto,
  ) {
    return this.leads.create(tenantId, dto);
  }

  @Patch('leads/:id')
  updateLead(
    @CurrentUser('tenantId') tenantId: string,
    @Param('id') id: string,
    @Body() dto: UpdateLeadDto,
  ) {
    return this.leads.update(tenantId, id, dto);
  }

  @Delete('leads/:id')
  @Roles(Role.TENANT_ADMIN, Role.MANAGER)
  removeLead(
    @CurrentUser('tenantId') tenantId: string,
    @Param('id') id: string,
  ) {
    return this.leads.remove(tenantId, id);
  }

  @Post('leads/:id/convert')
  @HttpCode(200)
  convertLead(
    @CurrentUser('tenantId') tenantId: string,
    @Param('id') id: string,
    @Body() dto: ConvertLeadDto,
  ) {
    return this.leads.convert(tenantId, id, dto);
  }

  // ── Forms ────────────────────────────────────

  @Get('marketing/forms')
  listForms(@CurrentUser('tenantId') tenantId: string) {
    return this.pages.listForms(tenantId);
  }

  @Post('marketing/forms')
  createForm(
    @CurrentUser('tenantId') tenantId: string,
    @Body() dto: CreateFormDto,
  ) {
    return this.pages.createForm(tenantId, dto);
  }

  @Patch('marketing/forms/:id')
  updateForm(
    @CurrentUser('tenantId') tenantId: string,
    @Param('id') id: string,
    @Body() dto: UpdateFormDto,
  ) {
    return this.pages.updateForm(tenantId, id, dto);
  }

  @Delete('marketing/forms/:id')
  @Roles(Role.TENANT_ADMIN, Role.MANAGER)
  removeForm(
    @CurrentUser('tenantId') tenantId: string,
    @Param('id') id: string,
  ) {
    return this.pages.removeForm(tenantId, id);
  }

  @Get('marketing/submissions')
  submissions(
    @CurrentUser('tenantId') tenantId: string,
    @Query('formId') formId?: string,
  ) {
    return this.pages.listSubmissions(tenantId, formId);
  }

  // ── Landing pages ────────────────────────────

  @Get('marketing/pages')
  listPages(@CurrentUser('tenantId') tenantId: string) {
    return this.pages.listPages(tenantId);
  }

  @Get('marketing/pages/stats')
  pageStats(@CurrentUser('tenantId') tenantId: string) {
    return this.pages.pageStats(tenantId);
  }

  @Get('marketing/pages/:id')
  getPage(@CurrentUser('tenantId') tenantId: string, @Param('id') id: string) {
    return this.pages.getPage(tenantId, id);
  }

  @Post('marketing/pages')
  createPage(
    @CurrentUser('tenantId') tenantId: string,
    @Body() dto: CreatePageDto,
  ) {
    return this.pages.createPage(tenantId, dto);
  }

  @Patch('marketing/pages/:id')
  updatePage(
    @CurrentUser('tenantId') tenantId: string,
    @Param('id') id: string,
    @Body() dto: UpdatePageDto,
  ) {
    return this.pages.updatePage(tenantId, id, dto);
  }

  @Post('marketing/pages/:id/publish')
  @HttpCode(200)
  publishPage(
    @CurrentUser('tenantId') tenantId: string,
    @Param('id') id: string,
  ) {
    return this.pages.publishPage(tenantId, id);
  }

  @Post('marketing/pages/:id/unpublish')
  @HttpCode(200)
  unpublishPage(
    @CurrentUser('tenantId') tenantId: string,
    @Param('id') id: string,
  ) {
    return this.pages.unpublishPage(tenantId, id);
  }

  @Delete('marketing/pages/:id')
  @Roles(Role.TENANT_ADMIN, Role.MANAGER)
  removePage(
    @CurrentUser('tenantId') tenantId: string,
    @Param('id') id: string,
  ) {
    return this.pages.removePage(tenantId, id);
  }

  // ── Analytics ────────────────────────────────

  @Get('marketing/attribution')
  attributionReport(
    @CurrentUser('tenantId') tenantId: string,
    @Query() query: AttributionQueryDto,
  ) {
    return this.attribution.revenue(tenantId, query);
  }

  @Get('marketing/roi')
  roi(
    @CurrentUser('tenantId') tenantId: string,
    @Query() query: AttributionQueryDto,
  ) {
    return this.attribution.campaignRoi(tenantId, query);
  }

  @Get('marketing/funnel')
  funnel(@CurrentUser('tenantId') tenantId: string) {
    return this.attribution.funnel(tenantId);
  }

  @Get('marketing/sources')
  sources(@CurrentUser('tenantId') tenantId: string) {
    return this.attribution.sources(tenantId);
  }

  // ── Public: the page a visitor sees ──────────

  @Public()
  @Get('p/:tenantId/:slug')
  publicPage(@Param('tenantId') tenantId: string, @Param('slug') slug: string) {
    return this.pages.publicPage(tenantId, slug);
  }

  @Public()
  @Post('p/:tenantId/forms/:formId')
  @HttpCode(200)
  publicSubmit(
    @Param('tenantId') tenantId: string,
    @Param('formId') formId: string,
    @Body() dto: SubmitFormDto,
  ) {
    return this.pages.submit(tenantId, formId, dto);
  }

  /**
   * Capture straight from an external site, for people who want the lead
   * without hosting the page here.
   */
  @Public()
  @Post('p/:tenantId/capture')
  @HttpCode(200)
  publicCapture(
    @Param('tenantId') tenantId: string,
    @Body() dto: CaptureLeadDto,
  ) {
    return (
      this.leads
        .capture(tenantId, { ...dto, source: dto.source ?? 'web_form' })
        // The lead id is not returned: an open endpoint must not hand out
        // references to CRM records.
        .then(() => ({ received: true }))
    );
  }
}
