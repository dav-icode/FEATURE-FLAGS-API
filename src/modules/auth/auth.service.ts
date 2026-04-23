import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateApiKeyDto, CreatedApiKeyResponse } from './dto/api-key.dto';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Creates a new API key.
   *
   * Security model:
   *   - Raw key is generated as "ff_<uuid>" (url-safe, high entropy)
   *   - Only the first 8 chars (prefix) are stored in plaintext for fast lookup
   *   - The full key is hashed with bcrypt (cost factor 12) before storage
   *   - Raw key is returned ONCE and never persisted
   */
  async create(dto: CreateApiKeyDto, createdBy: string): Promise<CreatedApiKeyResponse> {
    const rawKey = `ff_${uuidv4().replace(/-/g, '')}`;
    const prefix = rawKey.substring(0, 8);
    const keyHash = await bcrypt.hash(rawKey, 12);

    const record = await this.prisma.apiKey.create({
      data: {
        name: dto.name,
        keyHash,
        keyPrefix: prefix,
        permissions: dto.permissions,
        expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
        createdBy,
      },
    });

    this.logger.log(`API key created: "${dto.name}" by ${createdBy}`);

    return {
      id: record.id,
      name: record.name,
      key: rawKey,                           // Only exposure of the raw key
      permissions: record.permissions,
      expiresAt: record.expiresAt?.toISOString(),
    };
  }

  /**
   * Lists all API keys. Raw keys are never returned; only metadata.
   */
  async findAll() {
    return this.prisma.apiKey.findMany({
      select: {
        id: true,
        name: true,
        keyPrefix: true,
        permissions: true,
        enabled: true,
        expiresAt: true,
        lastUsedAt: true,
        createdBy: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Revokes an API key. Revocation is immediate — the key stops working
   * on the next request (guard checks the `enabled` flag in DB).
   */
  async revoke(id: string, callerName: string): Promise<void> {
    const key = await this.prisma.apiKey.findUnique({ where: { id } });
    if (!key) throw new NotFoundException(`API key "${id}" not found`);

    await this.prisma.apiKey.update({ where: { id }, data: { enabled: false } });
    this.logger.log(`API key "${key.name}" revoked by ${callerName}`);
  }
}
