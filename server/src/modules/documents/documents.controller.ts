import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Ip,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags } from '@nestjs/swagger';
import { Request, Response } from 'express';
import { Role } from '@prisma/client';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { Public } from '../../common/decorators/public.decorator';
import {
  DocumentsService,
  UploadedFile as StoredUpload,
} from './documents.service';
import {
  CreateFolderDto,
  CreateShareDto,
  GenerateDocumentDto,
  QueryDocumentsDto,
  ReadingTimeDto,
  SignShareDto,
  TemplateDto,
  UpdateDocumentDto,
  UploadMetaDto,
} from './dto/documents.dto';

/** Sends bytes back as a download rather than as JSON. */
function sendFile(
  res: Response,
  file: { name: string; mimeType: string; body: Buffer },
) {
  res.setHeader('Content-Type', file.mimeType);
  // The filename is quoted and stripped of quotes of its own, so a document
  // called `x".pdf` cannot break out of the header.
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${file.name.replace(/"/g, '')}"`,
  );
  res.send(file.body);
}

@ApiTags('documents')
@Controller()
export class DocumentsController {
  constructor(private readonly documents: DocumentsService) {}

  // ── Folders ──────────────────────────────────

  @Get('documents/folders')
  listFolders(@CurrentUser('tenantId') tenantId: string) {
    return this.documents.listFolders(tenantId);
  }

  @Post('documents/folders')
  createFolder(
    @CurrentUser('tenantId') tenantId: string,
    @Body() dto: CreateFolderDto,
  ) {
    return this.documents.createFolder(tenantId, dto);
  }

  @Delete('documents/folders/:id')
  @Roles(Role.TENANT_ADMIN, Role.MANAGER)
  removeFolder(
    @CurrentUser('tenantId') tenantId: string,
    @Param('id') id: string,
  ) {
    return this.documents.removeFolder(tenantId, id);
  }

  // ── Templates ────────────────────────────────

  @Get('documents/templates')
  listTemplates(@CurrentUser('tenantId') tenantId: string) {
    return this.documents.listTemplates(tenantId);
  }

  @Post('documents/templates')
  createTemplate(
    @CurrentUser('tenantId') tenantId: string,
    @Body() dto: TemplateDto,
  ) {
    return this.documents.createTemplate(tenantId, dto);
  }

  @Patch('documents/templates/:id')
  updateTemplate(
    @CurrentUser('tenantId') tenantId: string,
    @Param('id') id: string,
    @Body() dto: TemplateDto,
  ) {
    return this.documents.updateTemplate(tenantId, id, dto);
  }

  @Delete('documents/templates/:id')
  @Roles(Role.TENANT_ADMIN, Role.MANAGER)
  removeTemplate(
    @CurrentUser('tenantId') tenantId: string,
    @Param('id') id: string,
  ) {
    return this.documents.removeTemplate(tenantId, id);
  }

  @Post('documents/generate')
  generate(
    @CurrentUser('tenantId') tenantId: string,
    @CurrentUser('userId') userId: string,
    @Body() dto: GenerateDocumentDto,
  ) {
    return this.documents.generate(tenantId, userId, dto);
  }

  // ── Documents ────────────────────────────────

  @Get('documents/expiring')
  expiring(
    @CurrentUser('tenantId') tenantId: string,
    @Query('days') days?: string,
  ) {
    return this.documents.expiring(
      tenantId,
      days ? parseInt(days, 10) : undefined,
    );
  }

  @Get('documents')
  list(
    @CurrentUser('tenantId') tenantId: string,
    @Query() query: QueryDocumentsDto,
  ) {
    return this.documents.list(tenantId, query);
  }

  @Post('documents')
  @UseInterceptors(FileInterceptor('file'))
  upload(
    @CurrentUser('tenantId') tenantId: string,
    @CurrentUser('userId') userId: string,
    @UploadedFile() file: StoredUpload,
    @Body() dto: UploadMetaDto,
  ) {
    return this.documents.upload(tenantId, userId, file, dto);
  }

  @Get('documents/:id')
  get(@CurrentUser('tenantId') tenantId: string, @Param('id') id: string) {
    return this.documents.get(tenantId, id);
  }

  @Get('documents/:id/activity')
  activity(@CurrentUser('tenantId') tenantId: string, @Param('id') id: string) {
    return this.documents.activity(tenantId, id);
  }

  @Get('documents/:id/download')
  @Header('Cache-Control', 'no-store')
  async download(
    @CurrentUser('tenantId') tenantId: string,
    @Param('id') id: string,
    @Res() res: Response,
    @Query('version') version?: string,
  ) {
    const file = await this.documents.download(
      tenantId,
      id,
      version ? parseInt(version, 10) : undefined,
    );
    sendFile(res, file);
  }

  @Post('documents/:id/versions')
  @UseInterceptors(FileInterceptor('file'))
  addVersion(
    @CurrentUser('tenantId') tenantId: string,
    @CurrentUser('userId') userId: string,
    @Param('id') id: string,
    @UploadedFile() file: StoredUpload,
    @Body('note') note?: string,
  ) {
    return this.documents.addVersion(tenantId, id, userId, file, note);
  }

  @Patch('documents/:id')
  update(
    @CurrentUser('tenantId') tenantId: string,
    @Param('id') id: string,
    @Body() dto: UpdateDocumentDto,
  ) {
    return this.documents.update(tenantId, id, dto);
  }

  @Delete('documents/:id')
  @Roles(Role.TENANT_ADMIN, Role.MANAGER)
  remove(@CurrentUser('tenantId') tenantId: string, @Param('id') id: string) {
    return this.documents.remove(tenantId, id);
  }

  // ── Sharing ──────────────────────────────────

  @Post('documents/:id/shares')
  createShare(
    @CurrentUser('tenantId') tenantId: string,
    @CurrentUser('userId') userId: string,
    @Param('id') id: string,
    @Body() dto: CreateShareDto,
  ) {
    return this.documents.createShare(tenantId, id, userId, dto);
  }

  @Delete('documents/shares/:shareId')
  revokeShare(
    @CurrentUser('tenantId') tenantId: string,
    @Param('shareId') shareId: string,
  ) {
    return this.documents.revokeShare(tenantId, shareId);
  }

  // ── The link a recipient holds ───────────────

  @Public()
  @Get('d/:token')
  viewShare(
    @Param('token') token: string,
    @Ip() ip: string,
    @Req() req: Request,
  ) {
    return this.documents.viewShare(token, ip, req.headers['user-agent']);
  }

  @Public()
  @Get('d/:token/file')
  @Header('Cache-Control', 'no-store')
  async downloadShare(
    @Param('token') token: string,
    @Ip() ip: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const file = await this.documents.downloadShare(
      token,
      ip,
      req.headers['user-agent'],
    );
    sendFile(res, file);
  }

  @Public()
  @Post('d/:token/sign')
  @HttpCode(200)
  sign(
    @Param('token') token: string,
    @Body() dto: SignShareDto,
    @Ip() ip: string,
  ) {
    return this.documents.signShare(token, dto, ip);
  }

  @Public()
  @Post('d/:token/reading-time')
  @HttpCode(200)
  readingTime(@Param('token') token: string, @Body() dto: ReadingTimeDto) {
    return this.documents.recordReadingTime(token, dto.seconds);
  }
}
