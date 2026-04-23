import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../../prisma/prisma.service';
import { PERMISSIONS_KEY } from '../decorators/requires-permissions.decorator';

/**
 * ApiKeyGuard — authenticates every request using a Bearer API key.
 *
 * Flow:
 *   1. Extract key from Authorization header (Bearer <key>)
 *   2. Read the first 8 chars (prefix) to narrow DB lookup
 *   3. Compare full key against stored bcrypt hash
 *   4. Verify key is enabled and not expired
 *   5. Check required permissions from route decorator
 *   6. Update lastUsedAt (fire-and-forget, non-blocking)
 */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  private readonly logger = new Logger(ApiKeyGuard.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();

    const rawKey = this.extractKey(request);
    if (!rawKey) {
      throw new UnauthorizedException('Missing API key. Use: Authorization: Bearer <key>');
    }

    // Fast prefix lookup — avoids full table scan
    const prefix = rawKey.substring(0, 8);
    const candidates = await this.prisma.apiKey.findMany({
      where: { keyPrefix: prefix, enabled: true },
      select: {
        id: true,
        keyHash: true,
        permissions: true,
        expiresAt: true,
        name: true,
      },
    });

    if (!candidates.length) {
      throw new UnauthorizedException('Invalid API key');
    }

    // Compare raw key against each candidate hash
    let matchedKey: (typeof candidates)[0] | undefined;
    for (const candidate of candidates) {
      const valid = await bcrypt.compare(rawKey, candidate.keyHash);
      if (valid) {
        matchedKey = candidate;
        break;
      }
    }

    if (!matchedKey) {
      throw new UnauthorizedException('Invalid API key');
    }

    // Check expiry
    if (matchedKey.expiresAt && matchedKey.expiresAt < new Date()) {
      throw new UnauthorizedException('API key has expired');
    }

    // Check required permissions declared on the route
    const requiredPermissions = this.reflector.getAllAndOverride<string[]>(
      PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (requiredPermissions?.length) {
      const hasAll = requiredPermissions.every((p) =>
        matchedKey!.permissions.includes(p),
      );
      if (!hasAll) {
        throw new UnauthorizedException(
          `This API key lacks required permissions: ${requiredPermissions.join(', ')}`,
        );
      }
    }

    // Attach identity to request for downstream use (e.g. audit logs)
    (request as any).apiKeyName = matchedKey.name;
    (request as any).apiKeyId = matchedKey.id;

    // Fire-and-forget: update lastUsedAt without blocking the request
    this.prisma.apiKey
      .update({ where: { id: matchedKey.id }, data: { lastUsedAt: new Date() } })
      .catch((err) => this.logger.error('Failed to update lastUsedAt', err));

    return true;
  }

  private extractKey(request: Request): string | undefined {
    const authHeader = request.headers['authorization'];
    if (!authHeader?.startsWith('Bearer ')) return undefined;
    const key = authHeader.substring(7).trim();
    return key.length > 0 ? key : undefined;
  }
}
