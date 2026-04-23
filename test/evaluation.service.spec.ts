import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { NotFoundException } from '@nestjs/common';
import { RuleType } from '@prisma/client';
import { EvaluationService } from '../../src/modules/evaluation/evaluation.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import { RedisService } from '../../src/redis/redis.service';

// ── Helpers to build mock flag objects ───────────────────────────────

const makeFlag = (overrides = {}) => ({
  id: 'flag_1',
  key: 'test-flag',
  name: 'Test Flag',
  description: null,
  enabled: true,
  rules: [],
  createdBy: 'test',
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

const makeRule = (type: RuleType, value: object, priority = 0) => ({
  id: `rule_${Math.random()}`,
  flagId: 'flag_1',
  type,
  value,
  priority,
  createdAt: new Date(),
});

// ── Mocks ─────────────────────────────────────────────────────────────

const mockPrisma = {
  flag: {
    findUnique: jest.fn(),
    findMany: jest.fn(),
  },
};

const mockRedis = {
  get: jest.fn().mockResolvedValue(null),   // Always cache miss by default
  set: jest.fn().mockResolvedValue(undefined),
  evalCacheKey: jest.fn((k, u, e) => `ff:eval:${k}:${u}:${e}`),
  flagCacheKey: jest.fn((k) => `ff:flag:${k}`),
  flagPatternKey: jest.fn((k) => `ff:*:${k}:*`),
};

const mockConfig = {
  get: jest.fn().mockReturnValue({ ttlSeconds: 30 }),
};

// ──────────────────────────────────────────────────────────────────────────────

describe('EvaluationService', () => {
  let service: EvaluationService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EvaluationService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: RedisService, useValue: mockRedis },
        { provide: ConfigService, useValue: mockConfig },
      ],
    }).compile();

    service = module.get<EvaluationService>(EvaluationService);
    jest.clearAllMocks();
    mockRedis.get.mockResolvedValue(null); // Reset to cache miss
  });

  // ── FLAG_DISABLED ───────────────────────────────────────────────────

  describe('when flag is disabled', () => {
    it('returns enabled=false with reason FLAG_DISABLED', async () => {
      mockPrisma.flag.findUnique.mockResolvedValue(makeFlag({ enabled: false }));

      const result = await service.evaluate('test-flag', {
        userId: 'user_1',
        environment: 'production',
      });

      expect(result.enabled).toBe(false);
      expect(result.reason).toBe('FLAG_DISABLED');
    });
  });

  // ── NO_RULES ────────────────────────────────────────────────────────

  describe('when flag is enabled with no rules', () => {
    it('returns enabled=true with reason NO_RULES (globally on)', async () => {
      mockPrisma.flag.findUnique.mockResolvedValue(makeFlag({ enabled: true, rules: [] }));

      const result = await service.evaluate('test-flag', {
        userId: 'user_1',
        environment: 'production',
      });

      expect(result.enabled).toBe(true);
      expect(result.reason).toBe('NO_RULES');
    });
  });

  // ── USER_LIST ───────────────────────────────────────────────────────

  describe('USER_LIST rule', () => {
    it('returns enabled=true when userId is in the list', async () => {
      mockPrisma.flag.findUnique.mockResolvedValue(
        makeFlag({
          rules: [makeRule(RuleType.USER_LIST, { userIds: ['user_vip', 'user_beta'] })],
        }),
      );

      const result = await service.evaluate('test-flag', {
        userId: 'user_vip',
        environment: 'production',
      });

      expect(result.enabled).toBe(true);
      expect(result.reason).toBe('RULE_USER_LIST');
    });

    it('returns enabled=false when userId is NOT in the list', async () => {
      mockPrisma.flag.findUnique.mockResolvedValue(
        makeFlag({
          rules: [makeRule(RuleType.USER_LIST, { userIds: ['user_vip'] })],
        }),
      );

      const result = await service.evaluate('test-flag', {
        userId: 'user_random',
        environment: 'production',
      });

      expect(result.enabled).toBe(false);
      expect(result.reason).toBe('NO_RULE_MATCHED');
    });
  });

  // ── PERCENTAGE ──────────────────────────────────────────────────────

  describe('PERCENTAGE rule', () => {
    it('is deterministic — same user always gets same result', async () => {
      mockPrisma.flag.findUnique.mockResolvedValue(
        makeFlag({
          rules: [makeRule(RuleType.PERCENTAGE, { percentage: 50 })],
        }),
      );

      const ctx = { userId: 'stable_user_id', environment: 'production' };

      const results = await Promise.all([
        service.evaluate('test-flag', ctx),
        service.evaluate('test-flag', ctx),
        service.evaluate('test-flag', ctx),
      ]);

      // All evaluations for the same user must agree
      const enabled = results[0].enabled;
      expect(results.every((r) => r.enabled === enabled)).toBe(true);
    });

    it('returns disabled for 0% rollout', async () => {
      mockPrisma.flag.findUnique.mockResolvedValue(
        makeFlag({ rules: [makeRule(RuleType.PERCENTAGE, { percentage: 0 })] }),
      );

      const result = await service.evaluate('test-flag', {
        userId: 'any_user',
        environment: 'production',
      });

      expect(result.enabled).toBe(false);
    });

    it('returns enabled for 100% rollout', async () => {
      mockPrisma.flag.findUnique.mockResolvedValue(
        makeFlag({ rules: [makeRule(RuleType.PERCENTAGE, { percentage: 100 })] }),
      );

      const result = await service.evaluate('test-flag', {
        userId: 'any_user',
        environment: 'production',
      });

      expect(result.enabled).toBe(true);
      expect(result.reason).toBe('RULE_PERCENTAGE');
    });
  });

  // ── ENVIRONMENT ─────────────────────────────────────────────────────

  describe('ENVIRONMENT rule', () => {
    it('enables flag in matching environment', async () => {
      mockPrisma.flag.findUnique.mockResolvedValue(
        makeFlag({
          rules: [makeRule(RuleType.ENVIRONMENT, { environments: ['staging', 'development'] })],
        }),
      );

      const result = await service.evaluate('test-flag', {
        userId: 'u1',
        environment: 'staging',
      });

      expect(result.enabled).toBe(true);
      expect(result.reason).toBe('RULE_ENVIRONMENT');
    });

    it('disables flag in non-matching environment', async () => {
      mockPrisma.flag.findUnique.mockResolvedValue(
        makeFlag({
          rules: [makeRule(RuleType.ENVIRONMENT, { environments: ['development'] })],
        }),
      );

      const result = await service.evaluate('test-flag', {
        userId: 'u1',
        environment: 'production',
      });

      expect(result.enabled).toBe(false);
    });
  });

  // ── SCHEDULE ────────────────────────────────────────────────────────

  describe('SCHEDULE rule', () => {
    it('enables flag when current time is within schedule window', async () => {
      const past = new Date(Date.now() - 3_600_000).toISOString();   // 1 hour ago
      const future = new Date(Date.now() + 3_600_000).toISOString(); // 1 hour ahead

      mockPrisma.flag.findUnique.mockResolvedValue(
        makeFlag({
          rules: [makeRule(RuleType.SCHEDULE, { enableAt: past, disableAt: future })],
        }),
      );

      const result = await service.evaluate('test-flag', {
        userId: 'u1',
        environment: 'production',
      });

      expect(result.enabled).toBe(true);
      expect(result.reason).toBe('RULE_SCHEDULE');
    });

    it('disables flag when schedule has not started yet', async () => {
      const future1 = new Date(Date.now() + 3_600_000).toISOString();
      const future2 = new Date(Date.now() + 7_200_000).toISOString();

      mockPrisma.flag.findUnique.mockResolvedValue(
        makeFlag({
          rules: [makeRule(RuleType.SCHEDULE, { enableAt: future1, disableAt: future2 })],
        }),
      );

      const result = await service.evaluate('test-flag', {
        userId: 'u1',
        environment: 'production',
      });

      expect(result.enabled).toBe(false);
    });
  });

  // ── NOT FOUND ───────────────────────────────────────────────────────

  describe('when flag does not exist', () => {
    it('throws NotFoundException', async () => {
      mockPrisma.flag.findUnique.mockResolvedValue(null);

      await expect(
        service.evaluate('nonexistent-flag', { userId: 'u1', environment: 'production' }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ── CACHE ────────────────────────────────────────────────────────────

  describe('caching', () => {
    it('returns cached result without hitting the database', async () => {
      const cachedResult = {
        flagKey: 'test-flag',
        enabled: true,
        reason: 'NO_RULES',
        cachedAt: new Date().toISOString(),
      };
      mockRedis.get.mockResolvedValueOnce(cachedResult);

      const result = await service.evaluate('test-flag', {
        userId: 'u1',
        environment: 'production',
      });

      expect(result.reason).toBe('CACHED');
      expect(mockPrisma.flag.findUnique).not.toHaveBeenCalled();
    });
  });
});
