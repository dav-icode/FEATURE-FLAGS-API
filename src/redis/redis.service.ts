import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { AppConfig } from '../config/configuration';

/**
 * Redis service — wraps ioredis with typed helpers for flag caching.
 *
 * Cache key design:
 *   ff:eval:{flagKey}:{userId}:{env}  → boolean result
 *   ff:flag:{flagKey}                 → serialised Flag object
 */
@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private client!: Redis;

  constructor(private readonly config: ConfigService<AppConfig, true>) {}

  onModuleInit(): void {
    const { host, port, password } = this.config.get('redis', { infer: true });

    this.client = new Redis({
      host,
      port,
      password,
      lazyConnect: false,
      enableReadyCheck: true,
      maxRetriesPerRequest: 3,
      retryStrategy: (times) => Math.min(times * 200, 3000),
    });

    this.client.on('connect', () => this.logger.log('Redis connected'));
    this.client.on('error', (err) => this.logger.error('Redis error', err));
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.quit();
    this.logger.log('Redis connection closed');
  }

  // ── Generic helpers ────────────────────────────────────────────────

  async get<T>(key: string): Promise<T | null> {
    const raw = await this.client.get(key);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }

  async set(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    await this.client.set(key, JSON.stringify(value), 'EX', ttlSeconds);
  }

  async del(key: string): Promise<void> {
    await this.client.del(key);
  }

  /**
   * Deletes all cache keys matching a glob pattern.
   * Used to invalidate all evaluations for a specific flag when it changes.
   */
  async deletePattern(pattern: string): Promise<void> {
    const keys = await this.client.keys(pattern);
    if (keys.length > 0) {
      await this.client.del(...keys);
      this.logger.debug(`Invalidated ${keys.length} cache keys matching: ${pattern}`);
    }
  }

  // ── Flag-specific helpers ──────────────────────────────────────────

  evalCacheKey(flagKey: string, userId: string, environment: string): string {
    return `ff:eval:${flagKey}:${userId}:${environment}`;
  }

  flagCacheKey(flagKey: string): string {
    return `ff:flag:${flagKey}`;
  }

  flagPatternKey(flagKey: string): string {
    return `ff:*:${flagKey}:*`;
  }
}
