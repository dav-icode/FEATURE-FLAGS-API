import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FlagRule, RuleType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { AppConfig } from '../../config/configuration';
import { EvaluateDto, BulkEvaluateDto } from './dto/evaluate.dto';

// ──────────────────────────────────────────────────────────────────────────────
// Evaluation result shapes
// ──────────────────────────────────────────────────────────────────────────────

export interface EvaluationResult {
  flagKey: string;
  enabled: boolean;
  reason: EvaluationReason;
  cachedAt?: string;
}

export type EvaluationReason =
  | 'FLAG_DISABLED'       // Master switch is off
  | 'NO_RULES'            // Enabled but no rules → globally on
  | 'RULE_USER_LIST'      // Matched a user-list rule
  | 'RULE_PERCENTAGE'     // Matched a percentage rule
  | 'RULE_ENVIRONMENT'    // Matched an environment rule
  | 'RULE_SCHEDULE'       // Matched a schedule rule
  | 'NO_RULE_MATCHED'     // Enabled + has rules, but none matched this context
  | 'CACHED';             // Returned from Redis cache

// ──────────────────────────────────────────────────────────────────────────────

@Injectable()
export class EvaluationService {
  private readonly logger = new Logger(EvaluationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  // ── Single evaluation ─────────────────────────────────────────────

  async evaluate(flagKey: string, dto: EvaluateDto): Promise<EvaluationResult> {
    const { userId, environment } = dto;

    // 1. Check Redis cache first
    const cacheKey = this.redis.evalCacheKey(flagKey, userId, environment);
    const cached = await this.redis.get<EvaluationResult>(cacheKey);
    if (cached) {
      return { ...cached, reason: 'CACHED', cachedAt: cached.cachedAt };
    }

    // 2. Load flag from DB (with rules sorted by priority desc)
    const flag = await this.prisma.flag.findUnique({
      where: { key: flagKey },
      include: { rules: { orderBy: { priority: 'desc' } } },
    });

    if (!flag) throw new NotFoundException(`Flag "${flagKey}" not found`);

    // 3. Run evaluation logic
    const result = this.runEvaluation(flag.key, flag.enabled, flag.rules, dto);

    // 4. Cache the result
    const ttl = this.config.get('cache', { infer: true }).ttlSeconds;
    await this.redis.set(cacheKey, { ...result, cachedAt: new Date().toISOString() }, ttl);

    return result;
  }

  // ── Bulk evaluation ───────────────────────────────────────────────

  async evaluateBulk(dto: BulkEvaluateDto): Promise<EvaluationResult[]> {
    const { flagKeys, userId, environment } = dto;

    // Load all requested flags in a single query
    const flags = await this.prisma.flag.findMany({
      where: { key: { in: flagKeys } },
      include: { rules: { orderBy: { priority: 'desc' } } },
    });

    const foundKeys = new Set(flags.map((f) => f.key));
    const results: EvaluationResult[] = [];

    for (const key of flagKeys) {
      if (!foundKeys.has(key)) {
        // Unknown flags are always disabled — never throw in bulk evaluation
        results.push({ flagKey: key, enabled: false, reason: 'FLAG_DISABLED' });
        continue;
      }

      const flag = flags.find((f) => f.key === key)!;

      // Check cache per flag
      const cacheKey = this.redis.evalCacheKey(key, userId, environment);
      const cached = await this.redis.get<EvaluationResult>(cacheKey);
      if (cached) {
        results.push({ ...cached, reason: 'CACHED' });
        continue;
      }

      const result = this.runEvaluation(flag.key, flag.enabled, flag.rules, {
        userId,
        environment,
      });
      const ttl = this.config.get('cache', { infer: true }).ttlSeconds;
      await this.redis.set(cacheKey, { ...result, cachedAt: new Date().toISOString() }, ttl);
      results.push(result);
    }

    return results;
  }

  // ──────────────────────────────────────────────────────────────────
  // Core evaluation algorithm
  //
  // Decision tree:
  //   1. Flag disabled → false (FLAG_DISABLED)
  //   2. No rules     → true  (NO_RULES, globally on)
  //   3. Evaluate each rule in priority order — first match wins
  //   4. No rule matched → false (NO_RULE_MATCHED)
  // ──────────────────────────────────────────────────────────────────

  private runEvaluation(
    flagKey: string,
    enabled: boolean,
    rules: FlagRule[],
    ctx: EvaluateDto,
  ): EvaluationResult {
    // Step 1: master switch
    if (!enabled) {
      return { flagKey, enabled: false, reason: 'FLAG_DISABLED' };
    }

    // Step 2: no rules means globally enabled
    if (!rules.length) {
      return { flagKey, enabled: true, reason: 'NO_RULES' };
    }

    // Step 3: evaluate rules in priority order
    for (const rule of rules) {
      const match = this.evaluateRule(rule, ctx, flagKey);
      if (match !== null) {
        return { flagKey, enabled: match.matched, reason: match.reason };
      }
    }

    // Step 4: enabled but no rule matched this context
    return { flagKey, enabled: false, reason: 'NO_RULE_MATCHED' };
  }

  // ──────────────────────────────────────────────────────────────────
  // Individual rule evaluators
  // Returns null if the rule type is unrecognised (safe skip)
  // ──────────────────────────────────────────────────────────────────

  private evaluateRule(
    rule: FlagRule,
    ctx: EvaluateDto,
    flagKey: string,
  ): { matched: boolean; reason: EvaluationReason } | null {
    const value = rule.value as Record<string, unknown>;

    switch (rule.type) {
      case RuleType.USER_LIST: {
        const userIds = value['userIds'] as string[] | undefined;
        if (!Array.isArray(userIds)) return null;
        return {
          matched: userIds.includes(ctx.userId),
          reason: 'RULE_USER_LIST',
        };
      }

      case RuleType.PERCENTAGE: {
        const percentage = value['percentage'] as number | undefined;
        if (typeof percentage !== 'number') return null;

        // Deterministic hash: same userId always lands in the same bucket
        const bucket = this.hashToBucket(flagKey, ctx.userId);
        return {
          matched: bucket < percentage,
          reason: 'RULE_PERCENTAGE',
        };
      }

      case RuleType.ENVIRONMENT: {
        const environments = value['environments'] as string[] | undefined;
        if (!Array.isArray(environments)) return null;
        return {
          matched: environments.includes(ctx.environment),
          reason: 'RULE_ENVIRONMENT',
        };
      }

      case RuleType.SCHEDULE: {
        const enableAt = value['enableAt'] ? new Date(value['enableAt'] as string) : null;
        const disableAt = value['disableAt'] ? new Date(value['disableAt'] as string) : null;
        const now = new Date();

        const afterStart = enableAt ? now >= enableAt : true;
        const beforeEnd = disableAt ? now < disableAt : true;

        return {
          matched: afterStart && beforeEnd,
          reason: 'RULE_SCHEDULE',
        };
      }

      default:
        this.logger.warn(`Unknown rule type: ${rule.type} — skipping`);
        return null;
    }
  }

  // ──────────────────────────────────────────────────────────────────
  // Deterministic percentage hashing — djb2 variant
  //
  // Given the same (flagKey, userId) pair, this always returns the
  // same integer in [0, 99]. Users don't flip between buckets across
  // evaluations, making rollouts consistent and predictable.
  // ──────────────────────────────────────────────────────────────────

  private hashToBucket(flagKey: string, userId: string): number {
    const input = `${flagKey}:${userId}`;
    let hash = 5381;

    for (let i = 0; i < input.length; i++) {
      // hash * 33 + charCode
      hash = (hash << 5) + hash + input.charCodeAt(i);
      hash = hash & hash; // Force 32-bit integer (handles overflow)
    }

    return Math.abs(hash) % 100;
  }
}
