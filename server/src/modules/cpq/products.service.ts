import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CreatePriceBookDto,
  CreateProductDto,
  SetPriceDto,
  UpdateProductDto,
} from './dto/cpq.dto';

@Injectable()
export class ProductsService {
  constructor(private readonly prisma: PrismaService) {}

  // ── Catalogue ────────────────────────────────

  listProducts(tenantId: string, search?: string) {
    const where: Prisma.ProductWhereInput = { tenantId };
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { sku: { contains: search, mode: 'insensitive' } },
      ];
    }
    return this.prisma.product.findMany({ where, orderBy: { name: 'asc' } });
  }

  async getProduct(tenantId: string, id: string) {
    const product = await this.prisma.product.findFirst({
      where: { id, tenantId },
      include: { prices: { include: { priceBook: true } } },
    });
    if (!product) throw new NotFoundException('Product not found');
    return product;
  }

  async createProduct(tenantId: string, dto: CreateProductDto) {
    const existing = await this.prisma.product.findFirst({
      where: { tenantId, sku: dto.sku },
    });
    if (existing) {
      throw new BadRequestException(`SKU "${dto.sku}" is already in use`);
    }

    return this.prisma.product.create({
      data: {
        tenantId,
        sku: dto.sku,
        name: dto.name,
        description: dto.description,
        unitPrice: new Prisma.Decimal(dto.unitPrice),
        currency: dto.currency ?? 'INR',
        taxRate: new Prisma.Decimal(dto.taxRate ?? 18),
        hsnCode: dto.hsnCode,
        isActive: dto.isActive ?? true,
      },
    });
  }

  async updateProduct(tenantId: string, id: string, dto: UpdateProductDto) {
    await this.getProduct(tenantId, id);
    return this.prisma.product.update({
      where: { id },
      data: {
        name: dto.name,
        description: dto.description,
        unitPrice:
          dto.unitPrice === undefined
            ? undefined
            : new Prisma.Decimal(dto.unitPrice),
        taxRate:
          dto.taxRate === undefined
            ? undefined
            : new Prisma.Decimal(dto.taxRate),
        hsnCode: dto.hsnCode,
        isActive: dto.isActive,
      },
    });
  }

  /**
   * Products are referenced by historical quotes, so a product that has ever
   * been quoted is deactivated rather than deleted - deleting it would rewrite
   * what a customer was sent.
   */
  async removeProduct(tenantId: string, id: string) {
    await this.getProduct(tenantId, id);

    const quoted = await this.prisma.quoteLine.count({
      where: { tenantId, productId: id },
    });
    if (quoted > 0) {
      await this.prisma.product.update({
        where: { id },
        data: { isActive: false },
      });
      return {
        success: true,
        deactivated: true,
        reason: `Used on ${quoted} quote line(s), so it was deactivated instead of deleted`,
      };
    }

    await this.prisma.product.delete({ where: { id } });
    return { success: true, deactivated: false };
  }

  // ── Price books ──────────────────────────────

  listPriceBooks(tenantId: string) {
    return this.prisma.priceBook.findMany({
      where: { tenantId },
      orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
      include: { _count: { select: { entries: true } } },
    });
  }

  async getPriceBook(tenantId: string, id: string) {
    const book = await this.prisma.priceBook.findFirst({
      where: { id, tenantId },
      include: { entries: { include: { product: true } } },
    });
    if (!book) throw new NotFoundException('Price book not found');
    return book;
  }

  async createPriceBook(tenantId: string, dto: CreatePriceBookDto) {
    if (dto.isDefault) {
      await this.prisma.priceBook.updateMany({
        where: { tenantId, isDefault: true },
        data: { isDefault: false },
      });
    }
    return this.prisma.priceBook.create({
      data: {
        tenantId,
        name: dto.name,
        currency: dto.currency ?? 'INR',
        isDefault: dto.isDefault ?? false,
      },
    });
  }

  /** Sets or replaces one product's price in a book. */
  async setPrice(tenantId: string, priceBookId: string, dto: SetPriceDto) {
    await this.getPriceBook(tenantId, priceBookId);
    await this.getProduct(tenantId, dto.productId);

    return this.prisma.priceBookEntry.upsert({
      where: {
        priceBookId_productId: { priceBookId, productId: dto.productId },
      },
      update: { unitPrice: new Prisma.Decimal(dto.unitPrice) },
      create: {
        tenantId,
        priceBookId,
        productId: dto.productId,
        unitPrice: new Prisma.Decimal(dto.unitPrice),
      },
    });
  }

  async removePrice(tenantId: string, priceBookId: string, productId: string) {
    const entry = await this.prisma.priceBookEntry.findFirst({
      where: { tenantId, priceBookId, productId },
    });
    if (!entry) throw new NotFoundException('Price not set in this book');
    await this.prisma.priceBookEntry.delete({ where: { id: entry.id } });
    return { success: true };
  }

  async removePriceBook(tenantId: string, id: string) {
    const book = await this.getPriceBook(tenantId, id);
    if (book.isDefault) {
      throw new BadRequestException(
        'Cannot delete the default price book - make another one default first',
      );
    }
    await this.prisma.priceBook.delete({ where: { id } });
    return { success: true };
  }

  /**
   * The price to quote a product at: the price book wins, then the product's
   * own list price.
   */
  async resolvePrice(
    tenantId: string,
    productId: string,
    priceBookId?: string | null,
  ): Promise<number> {
    if (priceBookId) {
      const entry = await this.prisma.priceBookEntry.findFirst({
        where: { tenantId, priceBookId, productId },
      });
      if (entry) return Number(entry.unitPrice);
    }
    const product = await this.getProduct(tenantId, productId);
    return Number(product.unitPrice);
  }
}
