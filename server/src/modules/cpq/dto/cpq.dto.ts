import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEmail,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { QuoteStatus, Role } from '@prisma/client';

// ── Products ─────────────────────────────────

export class CreateProductDto {
  @IsString()
  @IsNotEmpty()
  sku!: string;

  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  unitPrice!: number;

  @IsOptional()
  @IsString()
  currency?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  taxRate?: number;

  /** Indian HSN (goods) or SAC (services) code */
  @IsOptional()
  @IsString()
  hsnCode?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateProductDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  unitPrice?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  taxRate?: number;

  @IsOptional()
  @IsString()
  hsnCode?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

// ── Price books ──────────────────────────────

export class CreatePriceBookDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsOptional()
  @IsString()
  currency?: string;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}

export class SetPriceDto {
  @IsString()
  @IsNotEmpty()
  productId!: string;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  unitPrice!: number;
}

// ── Quotes ───────────────────────────────────

export class QuoteLineDto {
  /** Omit for a free-text line that is not in the catalogue */
  @IsOptional()
  @IsString()
  productId?: string;

  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  quantity!: number;

  /** Falls back to the price book, then the product's list price */
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  unitPrice?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  discountPercent?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  taxRate?: number;
}

export class CreateQuoteDto {
  @IsOptional()
  @IsString()
  dealId?: string;

  @IsOptional()
  @IsString()
  contactId?: string;

  @IsOptional()
  @IsString()
  companyId?: string;

  @IsOptional()
  @IsString()
  priceBookId?: string;

  @IsOptional()
  @IsString()
  currency?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  discountPercent?: number;

  @IsOptional()
  @IsDateString()
  validUntil?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsString()
  terms?: string;

  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => QuoteLineDto)
  lines!: QuoteLineDto[];
}

export class UpdateQuoteDto {
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  discountPercent?: number;

  @IsOptional()
  @IsDateString()
  validUntil?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsString()
  terms?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => QuoteLineDto)
  lines?: QuoteLineDto[];
}

export class QueryQuotesDto {
  @IsOptional()
  @IsIn(Object.values(QuoteStatus))
  status?: QuoteStatus;

  @IsOptional()
  @IsString()
  dealId?: string;
}

export class RejectQuoteDto {
  @IsString()
  @IsNotEmpty()
  reason!: string;
}

/** Posted from the customer-facing page. */
export class AcceptQuoteDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsOptional()
  @IsEmail()
  email?: string;
}

export class DeclineQuoteDto {
  @IsOptional()
  @IsString()
  reason?: string;
}

// ── Discount rules ───────────────────────────

export class CreateDiscountRuleDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  priority?: number;

  @IsOptional()
  @IsArray()
  @IsIn(Object.values(Role), { each: true })
  appliesToRoles?: Role[];

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  maxDiscountPercent!: number;

  @IsOptional()
  @IsIn(Object.values(Role))
  approverRole?: Role;
}

// ── Invoices ─────────────────────────────────

export class CreateInvoiceDto {
  @IsOptional()
  @IsDateString()
  dueAt?: string;

  @IsOptional()
  @IsString()
  customerGstin?: string;
}
