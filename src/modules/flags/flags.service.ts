import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { AuditAction, Flag, FlagRule, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { AuditService } from '../audit/audit.service';
import {
  CreateFlagDto,
  CreateRuleDto,
  FlagQueryDto,
  ToggleFlagDto,
  UpdateFlagDto,
} from './dto/flags.dto';

export type FlagWithRules = Flag & { rules: FlagRule[] };

@Injectable()
export class FlagsService {
  private readonly logger = new Logger(FlagsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly audit: AuditService,
  ) {}

  // ── List ──────────────────────────────────────────────────────────

  async findAll(query: FlagQueryDto): Promise<FlagWithRules[]> {
    const where: Prisma.FlagWhereInput = {};

    if (query.enabled !== undefined) {
      where.enabled = query.enabled;
    }
    if (query.search) {
      where.key = { contains: query.search, mode: 'insensitive' };
    }

    return this.prisma.flag.findMany({
      where,
      include: { rules: { orderBy: { priority: 'desc' } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  // ── Get one ───────────────────────────────────────────────────────

  async findOne(key: string): Promise<FlagWithRules> {
    const flag = await this.prisma.flag.findUnique({
      where: { key },
      include: { rules: { orderBy: { priority: 'desc' } } },
    });
    if (!flag) throw new NotFoundException(`Flag "${key}" not found`);
    return flag;
  }

  // ── Create ────────────────────────────────────────────────────────

  async create(dto: CreateFlagDto, callerName: string): Promise<FlagWithRules> {
    const existing = await this.prisma.flag.findUnique({ where: { key: dto.key } });
    if (existing) {
      throw new ConflictException(`A flag with key "${dto.key}" already exists`);
    }

    const flag = await this.prisma.flag.create({
      data: {
        key: dto.key,
        name: dto.name,
        description: dto.description,
        enabled: dto.enabled ?? false,
        createdBy: callerName,
      },
      include: { rules: true },
    });

    await this.audit.log({
      flagId: flag.id,
      action: AuditAction.FLAG_CREATED,
      after: flag,
      performedBy: callerName,
    });

    this.logger.log(`Flag created: ${flag.key} by ${callerName}`);
    return flag;
  }

  // ── Update ────────────────────────────────────────────────────────

  async update(key: string, dto: UpdateFlagDto, callerName: string): Promise<FlagWithRules> {
    const existing = await this.findOne(key);

    const updated = await this.prisma.flag.update({
      where: { key },
      data: dto,
      include: { rules: { orderBy: { priority: 'desc' } } },
    });

    await this.audit.log({
      flagId: existing.id,
      action: AuditAction.FLAG_UPDATED,
      before: existing,
      after: updated,
      performedBy: callerName,
    });

    await this.invalidateCache(key);
    this.logger.log(`Flag updated: ${key} by ${callerName}`);
    return updated;
  }

  // ── Toggle ────────────────────────────────────────────────────────

  async toggle(key: string, dto: ToggleFlagDto, callerName: string): Promise<FlagWithRules> {
    const existing = await this.findOne(key);

    const updated = await this.prisma.flag.update({
      where: { key },
      data: { enabled: dto.enabled },
      include: { rules: { orderBy: { priority: 'desc' } } },
    });

    await this.audit.log({
      flagId: existing.id,
      action: AuditAction.FLAG_TOGGLED,
      before: { enabled: existing.enabled },
      after: { enabled: dto.enabled },
      performedBy: callerName,
    });

    await this.invalidateCache(key);
    this.logger.log(`Flag "${key}" toggled to ${dto.enabled} by ${callerName}`);
    return updated;
  }

  // ── Delete ────────────────────────────────────────────────────────

  async remove(key: string, callerName: string): Promise<void> {
    const existing = await this.findOne(key);

    // Audit log is cascade-deleted with the flag, so log before deletion
    await this.audit.log({
      flagId: existing.id,
      action: AuditAction.FLAG_DELETED,
      before: existing,
      performedBy: callerName,
    });

    await this.prisma.flag.delete({ where: { key } });
    await this.invalidateCache(key);
    this.logger.log(`Flag deleted: ${key} by ${callerName}`);
  }

  // ── Rules ─────────────────────────────────────────────────────────

  async addRule(key: string, dto: CreateRuleDto, callerName: string): Promise<FlagWithRules> {
    const flag = await this.findOne(key);

    const rule = await this.prisma.flagRule.create({
      data: {
        flagId: flag.id,
        type: dto.type,
        value: dto.value as Prisma.InputJsonValue,
        priority: dto.priority ?? 0,
      },
    });

    await this.audit.log({
      flagId: flag.id,
      action: AuditAction.RULE_ADDED,
      after: rule,
      performedBy: callerName,
    });

    await this.invalidateCache(key);
    return this.findOne(key);
  }

  async removeRule(key: string, ruleId: string, callerName: string): Promise<FlagWithRules> {
    const flag = await this.findOne(key);
    const rule = flag.rules.find((r) => r.id === ruleId);
    if (!rule) throw new NotFoundException(`Rule "${ruleId}" not found on flag "${key}"`);

    await this.prisma.flagRule.delete({ where: { id: ruleId } });

    await this.audit.log({
      flagId: flag.id,
      action: AuditAction.RULE_REMOVED,
      before: rule,
      performedBy: callerName,
    });

    await this.invalidateCache(key);
    return this.findOne(key);
  }

  // ── Cache ─────────────────────────────────────────────────────────

  private async invalidateCache(flagKey: string): Promise<void> {
    await this.redis.deletePattern(this.redis.flagPatternKey(flagKey));
    await this.redis.del(this.redis.flagCacheKey(flagKey));
  }
}
