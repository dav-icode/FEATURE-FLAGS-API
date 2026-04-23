import { Injectable, Logger } from '@nestjs/common';
import { AuditAction, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

interface LogParams {
  flagId: string;
  action: AuditAction;
  before?: unknown;
  after?: unknown;
  performedBy: string;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Records an immutable audit log entry.
   * Called internally by FlagsService on every state change.
   */
  async log(params: LogParams): Promise<void> {
    const { flagId, action, before, after, performedBy } = params;

    try {
      await this.prisma.auditLog.create({
        data: {
          flagId,
          action,
          before: before ? (before as Prisma.InputJsonValue) : Prisma.JsonNull,
          after: after ? (after as Prisma.InputJsonValue) : Prisma.JsonNull,
          performedBy,
        },
      });
    } catch (err) {
      // Never let audit failures block the main operation
      this.logger.error(`Failed to write audit log for ${action} on ${flagId}`, err);
    }
  }

  /**
   * Returns the full change history for a flag, newest first.
   */
  async findByFlag(flagId: string, limit = 50) {
    return this.prisma.auditLog.findMany({
      where: { flagId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  /**
   * Returns recent changes across all flags — useful for a global activity feed.
   */
  async findRecent(limit = 100) {
    return this.prisma.auditLog.findMany({
      include: { flag: { select: { key: true, name: true } } },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }
}
