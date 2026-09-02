import {
  Body,
  Controller,
  Delete,
  Get,
  Ip,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { ProductsService } from './products.service';
import { QuotesService } from './quotes.service';
import {
  AcceptQuoteDto,
  CreateDiscountRuleDto,
  CreateInvoiceDto,
  CreatePriceBookDto,
  CreateProductDto,
  CreateQuoteDto,
  DeclineQuoteDto,
  QueryQuotesDto,
  RejectQuoteDto,
  SetPriceDto,
  UpdateProductDto,
  UpdateQuoteDto,
} from './dto/cpq.dto';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';

@Controller()
export class CpqController {
  constructor(
    private readonly products: ProductsService,
    private readonly quotes: QuotesService,
  ) {}

  // ── Products ─────────────────────────────────

  @Get('products')
  listProducts(
    @CurrentUser('tenantId') tenantId: string,
    @Query('search') search?: string,
  ) {
    return this.products.listProducts(tenantId, search);
  }

  @Get('products/:id')
  getProduct(
    @CurrentUser('tenantId') tenantId: string,
    @Param('id') id: string,
  ) {
    return this.products.getProduct(tenantId, id);
  }

  @Post('products')
  @Roles(Role.TENANT_ADMIN, Role.MANAGER)
  createProduct(
    @CurrentUser('tenantId') tenantId: string,
    @Body() dto: CreateProductDto,
  ) {
    return this.products.createProduct(tenantId, dto);
  }

  @Patch('products/:id')
  @Roles(Role.TENANT_ADMIN, Role.MANAGER)
  updateProduct(
    @CurrentUser('tenantId') tenantId: string,
    @Param('id') id: string,
    @Body() dto: UpdateProductDto,
  ) {
    return this.products.updateProduct(tenantId, id, dto);
  }

  @Delete('products/:id')
  @Roles(Role.TENANT_ADMIN, Role.MANAGER)
  removeProduct(
    @CurrentUser('tenantId') tenantId: string,
    @Param('id') id: string,
  ) {
    return this.products.removeProduct(tenantId, id);
  }

  // ── Price books ──────────────────────────────

  @Get('price-books')
  listPriceBooks(@CurrentUser('tenantId') tenantId: string) {
    return this.products.listPriceBooks(tenantId);
  }

  @Get('price-books/:id')
  getPriceBook(
    @CurrentUser('tenantId') tenantId: string,
    @Param('id') id: string,
  ) {
    return this.products.getPriceBook(tenantId, id);
  }

  @Post('price-books')
  @Roles(Role.TENANT_ADMIN, Role.MANAGER)
  createPriceBook(
    @CurrentUser('tenantId') tenantId: string,
    @Body() dto: CreatePriceBookDto,
  ) {
    return this.products.createPriceBook(tenantId, dto);
  }

  @Post('price-books/:id/prices')
  @Roles(Role.TENANT_ADMIN, Role.MANAGER)
  setPrice(
    @CurrentUser('tenantId') tenantId: string,
    @Param('id') id: string,
    @Body() dto: SetPriceDto,
  ) {
    return this.products.setPrice(tenantId, id, dto);
  }

  @Delete('price-books/:id/prices/:productId')
  @Roles(Role.TENANT_ADMIN, Role.MANAGER)
  removePrice(
    @CurrentUser('tenantId') tenantId: string,
    @Param('id') id: string,
    @Param('productId') productId: string,
  ) {
    return this.products.removePrice(tenantId, id, productId);
  }

  @Delete('price-books/:id')
  @Roles(Role.TENANT_ADMIN, Role.MANAGER)
  removePriceBook(
    @CurrentUser('tenantId') tenantId: string,
    @Param('id') id: string,
  ) {
    return this.products.removePriceBook(tenantId, id);
  }

  // ── Quotes ───────────────────────────────────

  @Get('quotes')
  listQuotes(
    @CurrentUser('tenantId') tenantId: string,
    @Query() query: QueryQuotesDto,
  ) {
    return this.quotes.listQuotes(tenantId, query);
  }

  @Get('quotes/:id')
  getQuote(@CurrentUser('tenantId') tenantId: string, @Param('id') id: string) {
    return this.quotes.getQuote(tenantId, id);
  }

  @Post('quotes')
  @Roles(Role.TENANT_ADMIN, Role.MANAGER, Role.SALES_REP)
  createQuote(
    @CurrentUser('tenantId') tenantId: string,
    @CurrentUser('userId') userId: string,
    @CurrentUser('role') role: Role,
    @Body() dto: CreateQuoteDto,
  ) {
    return this.quotes.createQuote(tenantId, userId, role, dto);
  }

  @Patch('quotes/:id')
  @Roles(Role.TENANT_ADMIN, Role.MANAGER, Role.SALES_REP)
  updateQuote(
    @CurrentUser('tenantId') tenantId: string,
    @CurrentUser('role') role: Role,
    @Param('id') id: string,
    @Body() dto: UpdateQuoteDto,
  ) {
    return this.quotes.updateQuote(tenantId, id, role, dto);
  }

  @Delete('quotes/:id')
  @Roles(Role.TENANT_ADMIN, Role.MANAGER)
  removeQuote(
    @CurrentUser('tenantId') tenantId: string,
    @Param('id') id: string,
  ) {
    return this.quotes.removeQuote(tenantId, id);
  }

  @Post('quotes/:id/approve')
  @Roles(Role.TENANT_ADMIN, Role.MANAGER)
  approve(
    @CurrentUser('tenantId') tenantId: string,
    @CurrentUser('userId') userId: string,
    @CurrentUser('role') role: Role,
    @Param('id') id: string,
  ) {
    return this.quotes.approve(tenantId, id, userId, role);
  }

  @Post('quotes/:id/reject')
  @Roles(Role.TENANT_ADMIN, Role.MANAGER)
  reject(
    @CurrentUser('tenantId') tenantId: string,
    @CurrentUser('userId') userId: string,
    @Param('id') id: string,
    @Body() dto: RejectQuoteDto,
  ) {
    return this.quotes.reject(tenantId, id, userId, dto.reason);
  }

  @Post('quotes/:id/send')
  @Roles(Role.TENANT_ADMIN, Role.MANAGER, Role.SALES_REP)
  send(@CurrentUser('tenantId') tenantId: string, @Param('id') id: string) {
    return this.quotes.send(tenantId, id);
  }

  @Post('quotes/:id/invoice')
  @Roles(Role.TENANT_ADMIN, Role.MANAGER)
  invoice(
    @CurrentUser('tenantId') tenantId: string,
    @Param('id') id: string,
    @Body() dto: CreateInvoiceDto,
  ) {
    return this.quotes.convertToInvoice(tenantId, id, dto);
  }

  // ── Customer-facing (public, token-addressed) ──

  @Public()
  @Get('q/:token')
  publicQuote(@Param('token') token: string) {
    return this.quotes.getByToken(token);
  }

  @Public()
  @Post('q/:token/accept')
  accept(
    @Param('token') token: string,
    @Body() dto: AcceptQuoteDto,
    @Ip() ip: string,
  ) {
    return this.quotes.acceptByToken(token, dto, ip);
  }

  @Public()
  @Post('q/:token/decline')
  decline(@Param('token') token: string, @Body() dto: DeclineQuoteDto) {
    return this.quotes.declineByToken(token, dto.reason);
  }

  // ── Invoices ─────────────────────────────────

  @Get('invoices')
  listInvoices(@CurrentUser('tenantId') tenantId: string) {
    return this.quotes.listInvoices(tenantId);
  }

  @Post('invoices/:id/paid')
  @Roles(Role.TENANT_ADMIN, Role.MANAGER)
  markPaid(@CurrentUser('tenantId') tenantId: string, @Param('id') id: string) {
    return this.quotes.markInvoicePaid(tenantId, id);
  }

  // ── Discount rules ───────────────────────────

  @Get('discount-rules')
  listRules(@CurrentUser('tenantId') tenantId: string) {
    return this.quotes.listRules(tenantId);
  }

  @Post('discount-rules')
  @Roles(Role.TENANT_ADMIN)
  createRule(
    @CurrentUser('tenantId') tenantId: string,
    @Body() dto: CreateDiscountRuleDto,
  ) {
    return this.quotes.createRule(tenantId, dto);
  }

  @Delete('discount-rules/:id')
  @Roles(Role.TENANT_ADMIN)
  removeRule(
    @CurrentUser('tenantId') tenantId: string,
    @Param('id') id: string,
  ) {
    return this.quotes.removeRule(tenantId, id);
  }
}
