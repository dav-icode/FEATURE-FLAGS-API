import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiQuery, ApiTags } from '@nestjs/swagger';
import { ApiKeyGuard } from '../../common/guards/api-key.guard';
import { RequiresPermissions } from '../../common/decorators/requires-permissions.decorator';
import { AuditService } from './audit.service';

@ApiTags('Audit')
@ApiBearerAuth()
@UseGuards(ApiKeyGuard)
@Controller('audit')
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  @Get()
  @RequiresPermissions('audit:read')
  @ApiOperation({ summary: 'Get recent changes across all flags (global activity feed)' })
  @ApiQuery({ name: 'limit', required: false, example: 50 })
  findRecent(@Query('limit') limit?: string) {
    return this.auditService.findRecent(limit ? parseInt(limit, 10) : 100);
  }

  @Get('flags/:flagId')
  @RequiresPermissions('audit:read')
  @ApiOperation({ summary: 'Get full change history for a specific flag' })
  @ApiParam({ name: 'flagId', description: 'Internal flag ID (cuid)' })
  @ApiQuery({ name: 'limit', required: false, example: 50 })
  findByFlag(@Param('flagId') flagId: string, @Query('limit') limit?: string) {
    return this.auditService.findByFlag(flagId, limit ? parseInt(limit, 10) : 50);
  }
}
