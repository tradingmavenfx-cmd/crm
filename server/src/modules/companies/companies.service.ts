import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateCompanyDto } from './dto/create-company.dto';
import { UpdateCompanyDto } from './dto/update-company.dto';
import { QueryCompanyDto } from './dto/query-company.dto';

@Injectable()
export class CompaniesService {
  constructor(private readonly prisma: PrismaService) {}

  create(tenantId: string, dto: CreateCompanyDto) {
    return this.prisma.company.create({
      data: {
        tenantId,
        name: dto.name,
        domain: dto.domain,
        industry: dto.industry,
        website: dto.website,
        phone: dto.phone,
        employees: dto.employees,
        annualRev: dto.annualRev ? new Prisma.Decimal(dto.annualRev) : undefined,
        ownerId: dto.ownerId,
      },
    });
  }

  async findAll(tenantId: string, query: QueryCompanyDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;

    const where: Prisma.CompanyWhereInput = { tenantId };
    if (query.search) {
      where.OR = [
        { name: { contains: query.search, mode: 'insensitive' } },
        { domain: { contains: query.search, mode: 'insensitive' } },
        { industry: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    const [data, total] = await Promise.all([
      this.prisma.company.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.company.count({ where }),
    ]);

    return {
      data,
      meta: { total, page, limit, pages: Math.ceil(total / limit) },
    };
  }

  async findOne(tenantId: string, id: string) {
    const company = await this.prisma.company.findFirst({
      where: { id, tenantId },
    });
    if (!company) {
      throw new NotFoundException('Company not found');
    }
    return company;
  }

  async update(tenantId: string, id: string, dto: UpdateCompanyDto) {
    await this.findOne(tenantId, id);
    return this.prisma.company.update({
      where: { id },
      data: {
        ...dto,
        annualRev: dto.annualRev
          ? new Prisma.Decimal(dto.annualRev)
          : undefined,
      },
    });
  }

  async remove(tenantId: string, id: string) {
    await this.findOne(tenantId, id);
    await this.prisma.company.delete({ where: { id } });
    return { success: true };
  }
}
