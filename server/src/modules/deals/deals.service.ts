import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateDealDto } from './dto/create-deal.dto';
import { UpdateDealDto } from './dto/update-deal.dto';
import { CreateStageDto } from './dto/create-stage.dto';

@Injectable()
export class DealsService {
  constructor(private readonly prisma: PrismaService) {}

  // ── Pipeline stages ──────────────────────────
  createStage(tenantId: string, dto: CreateStageDto) {
    return this.prisma.dealStage.create({
      data: {
        tenantId,
        name: dto.name,
        order: dto.order,
        probability: dto.probability,
      },
    });
  }

  listStages(tenantId: string) {
    return this.prisma.dealStage.findMany({
      where: { tenantId },
      orderBy: { order: 'asc' },
    });
  }

  private async assertStage(tenantId: string, stageId: string) {
    const stage = await this.prisma.dealStage.findFirst({
      where: { id: stageId, tenantId },
    });
    if (!stage) {
      throw new BadRequestException('Invalid stage for this tenant');
    }
  }

  // ── Deals ────────────────────────────────────
  async create(tenantId: string, dto: CreateDealDto) {
    await this.assertStage(tenantId, dto.stageId);
    return this.prisma.deal.create({
      data: {
        tenantId,
        title: dto.title,
        value: dto.value ? new Prisma.Decimal(dto.value) : new Prisma.Decimal(0),
        currency: dto.currency ?? 'INR',
        stageId: dto.stageId,
        companyId: dto.companyId,
        contactId: dto.contactId,
        ownerId: dto.ownerId,
        status: dto.status ?? 'open',
      },
    });
  }

  findAll(tenantId: string) {
    return this.prisma.deal.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(tenantId: string, id: string) {
    const deal = await this.prisma.deal.findFirst({
      where: { id, tenantId },
    });
    if (!deal) {
      throw new NotFoundException('Deal not found');
    }
    return deal;
  }

  async update(tenantId: string, id: string, dto: UpdateDealDto) {
    await this.findOne(tenantId, id);
    if (dto.stageId) {
      await this.assertStage(tenantId, dto.stageId);
    }
    return this.prisma.deal.update({
      where: { id },
      data: {
        ...dto,
        value: dto.value ? new Prisma.Decimal(dto.value) : undefined,
        closedAt:
          dto.status === 'won' || dto.status === 'lost' ? new Date() : undefined,
      },
    });
  }

  async remove(tenantId: string, id: string) {
    await this.findOne(tenantId, id);
    await this.prisma.deal.delete({ where: { id } });
    return { success: true };
  }
}
