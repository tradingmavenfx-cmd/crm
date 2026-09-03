import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CreateTerritoryDto,
  UpdateTerritoryDto,
  TerritoryRules,
} from './dto/sales.dto';

/** A company as far as the rules are concerned. */
interface Matchable {
  city: string | null;
  state: string | null;
  country: string | null;
  industry: string | null;
  employees: number | null;
  domain: string | null;
}

const norm = (v: string | null | undefined) => (v ?? '').trim().toLowerCase();

/**
 * How well a territory's rules fit a company, or null when they do not.
 *
 * Every clause that is set must match — a territory for "manufacturing in
 * Karnataka" should not swallow every company in Karnataka. The score is the
 * number of clauses that had to match, so the most specific territory wins
 * when several fit.
 */
export function matchScore(
  rules: TerritoryRules,
  company: Matchable,
): number | null {
  let score = 0;

  const listClause = (
    values: string[] | undefined,
    field: string | null,
  ): boolean | null => {
    if (!values?.length) return null;
    score += 1;
    return values.map(norm).includes(norm(field));
  };

  const clauses = [
    listClause(rules.countries, company.country),
    listClause(rules.states, company.state),
    listClause(rules.cities, company.city),
    listClause(rules.industries, company.industry),
  ];

  if (rules.domains?.length) {
    score += 1;
    const domain = norm(company.domain);
    clauses.push(
      rules.domains.some(
        (d) => domain === norm(d) || domain.endsWith(`.${norm(d)}`),
      ),
    );
  }

  if (rules.minEmployees != null) {
    score += 1;
    clauses.push((company.employees ?? 0) >= rules.minEmployees);
  }
  if (rules.maxEmployees != null) {
    score += 1;
    clauses.push((company.employees ?? 0) <= rules.maxEmployees);
  }

  if (score === 0) return null; // No rules: hand-picked only.
  return clauses.every((c) => c !== false) ? score : null;
}

@Injectable()
export class TerritoriesService {
  constructor(private readonly prisma: PrismaService) {}

  list(tenantId: string) {
    return this.prisma.territory.findMany({
      where: { tenantId },
      orderBy: { name: 'asc' },
      include: {
        manager: { select: { id: true, firstName: true, lastName: true } },
        members: {
          select: {
            user: { select: { id: true, firstName: true, lastName: true } },
          },
        },
        _count: { select: { companies: true, children: true } },
      },
    });
  }

  async get(tenantId: string, id: string) {
    const territory = await this.prisma.territory.findFirst({
      where: { id, tenantId },
      include: {
        manager: { select: { id: true, firstName: true, lastName: true } },
        parent: { select: { id: true, name: true } },
        children: { select: { id: true, name: true } },
        members: {
          select: {
            id: true,
            user: { select: { id: true, firstName: true, lastName: true } },
          },
        },
      },
    });
    if (!territory) throw new NotFoundException('Territory not found');
    return territory;
  }

  async create(tenantId: string, dto: CreateTerritoryDto) {
    if (dto.parentId) await this.get(tenantId, dto.parentId);

    return this.prisma.territory.create({
      data: {
        tenantId,
        name: dto.name,
        description: dto.description,
        parentId: dto.parentId,
        managerId: dto.managerId,
        rules: (dto.rules ?? {}) as unknown as Prisma.InputJsonValue,
      },
    });
  }

  async update(tenantId: string, id: string, dto: UpdateTerritoryDto) {
    await this.get(tenantId, id);

    if (dto.parentId) {
      if (dto.parentId === id) {
        throw new BadRequestException('A territory cannot be its own parent');
      }
      // Walking up from the proposed parent must not lead back here, or the
      // tree becomes a loop and every rollup runs forever.
      const line = await this.ancestors(tenantId, dto.parentId);
      if (line.includes(id)) {
        throw new BadRequestException(
          'That would put the territory inside one of its own children',
        );
      }
    }

    return this.prisma.territory.update({
      where: { id },
      data: {
        name: dto.name,
        description: dto.description,
        parentId: dto.parentId,
        managerId: dto.managerId === '' ? null : dto.managerId,
        isActive: dto.isActive,
        rules: dto.rules as unknown as Prisma.InputJsonValue,
      },
    });
  }

  async remove(tenantId: string, id: string) {
    await this.get(tenantId, id);
    // Companies keep existing; they just stop belonging anywhere.
    await this.prisma.territory.delete({ where: { id } });
    return { success: true };
  }

  async addMember(tenantId: string, id: string, userId: string) {
    await this.get(tenantId, id);
    const user = await this.prisma.user.findFirst({
      where: { id: userId, tenantId },
      select: { id: true },
    });
    if (!user) throw new NotFoundException('User not found');

    return this.prisma.territoryMember.upsert({
      where: { territoryId_userId: { territoryId: id, userId } },
      update: {},
      create: { tenantId, territoryId: id, userId },
    });
  }

  async removeMember(tenantId: string, id: string, userId: string) {
    await this.get(tenantId, id);
    await this.prisma.territoryMember.deleteMany({
      where: { tenantId, territoryId: id, userId },
    });
    return { success: true };
  }

  // ── Assignment ───────────────────────────────

  /**
   * Files companies into territories by their rules.
   *
   * Only companies with no territory are touched by default: an account moved
   * by hand stays where it was put, which is the whole point of being able to
   * move it.
   */
  async assign(tenantId: string, reassignAll = false) {
    const territories = await this.prisma.territory.findMany({
      where: { tenantId, isActive: true },
      select: { id: true, name: true, rules: true },
    });

    const companies = await this.prisma.company.findMany({
      where: { tenantId, ...(reassignAll ? {} : { territoryId: null }) },
      select: {
        id: true,
        city: true,
        state: true,
        country: true,
        industry: true,
        employees: true,
        domain: true,
      },
    });

    const changes: { companyId: string; territoryId: string }[] = [];
    for (const company of companies) {
      let best: { id: string; score: number } | null = null;
      for (const territory of territories) {
        const score = matchScore(
          (territory.rules ?? {}) as TerritoryRules,
          company,
        );
        if (score !== null && (!best || score > best.score)) {
          best = { id: territory.id, score };
        }
      }
      if (best) changes.push({ companyId: company.id, territoryId: best.id });
    }

    for (const change of changes) {
      await this.prisma.company.update({
        where: { id: change.companyId },
        data: { territoryId: change.territoryId },
      });
    }

    return {
      considered: companies.length,
      assigned: changes.length,
      // The ones no rule claimed: worth seeing, since they belong to nobody.
      unmatched: companies.length - changes.length,
    };
  }

  // ── Hierarchy ────────────────────────────────

  /** Ids of every territory above this one. */
  async ancestors(tenantId: string, id: string): Promise<string[]> {
    const line: string[] = [];
    let current = await this.prisma.territory.findFirst({
      where: { id, tenantId },
      select: { id: true, parentId: true },
    });
    while (current?.parentId) {
      if (line.includes(current.parentId)) break; // Defensive: never loop.
      line.push(current.parentId);
      current = await this.prisma.territory.findFirst({
        where: { id: current.parentId, tenantId },
        select: { id: true, parentId: true },
      });
    }
    return line;
  }

  /** This territory and everything under it. */
  async subtree(tenantId: string, id: string): Promise<string[]> {
    const all = await this.prisma.territory.findMany({
      where: { tenantId },
      select: { id: true, parentId: true },
    });

    const ids = [id];
    for (let i = 0; i < ids.length; i += 1) {
      for (const t of all) {
        if (t.parentId === ids[i] && !ids.includes(t.id)) ids.push(t.id);
      }
    }
    return ids;
  }

  /**
   * How each territory is doing, counting everything underneath it — a region
   * that reports only its own directly-held accounts tells a manager nothing.
   */
  async performance(tenantId: string, from?: Date, to?: Date) {
    const territories = await this.prisma.territory.findMany({
      where: { tenantId },
      select: { id: true, name: true, parentId: true },
      orderBy: { name: 'asc' },
    });

    const companies = await this.prisma.company.findMany({
      where: { tenantId, territoryId: { not: null } },
      select: { id: true, territoryId: true },
    });

    const deals = await this.prisma.deal.findMany({
      where: {
        tenantId,
        companyId: { not: null },
        ...(from || to
          ? {
              createdAt: {
                ...(from ? { gte: from } : {}),
                ...(to ? { lte: to } : {}),
              },
            }
          : {}),
      },
      select: { companyId: true, value: true, status: true },
    });

    const territoryOf = new Map(companies.map((c) => [c.id, c.territoryId!]));
    const own = new Map<
      string,
      { won: number; open: number; lost: number; deals: number }
    >();
    for (const t of territories) {
      own.set(t.id, { won: 0, open: 0, lost: 0, deals: 0 });
    }

    for (const deal of deals) {
      const tid = deal.companyId ? territoryOf.get(deal.companyId) : undefined;
      if (!tid) continue;
      const row = own.get(tid);
      if (!row) continue;
      const value = Number(deal.value);
      row.deals += 1;
      if (deal.status === 'won') row.won += value;
      else if (deal.status === 'lost') row.lost += value;
      else row.open += value;
    }

    const childrenOf = new Map<string, string[]>();
    for (const t of territories) {
      if (!t.parentId) continue;
      childrenOf.set(t.parentId, [...(childrenOf.get(t.parentId) ?? []), t.id]);
    }

    const rollup = (
      id: string,
    ): {
      won: number;
      open: number;
      lost: number;
      deals: number;
    } => {
      const mine = own.get(id) ?? { won: 0, open: 0, lost: 0, deals: 0 };
      const totals = { ...mine };
      for (const child of childrenOf.get(id) ?? []) {
        const sub = rollup(child);
        totals.won += sub.won;
        totals.open += sub.open;
        totals.lost += sub.lost;
        totals.deals += sub.deals;
      }
      return totals;
    };

    return territories.map((t) => {
      const totals = rollup(t.id);
      const decided = totals.won + totals.lost;
      return {
        id: t.id,
        name: t.name,
        parentId: t.parentId,
        accounts: companies.filter((c) => c.territoryId === t.id).length,
        deals: totals.deals,
        won: totals.won,
        open: totals.open,
        lost: totals.lost,
        winRate: decided ? Math.round((totals.won / decided) * 100) : 0,
      };
    });
  }
}
