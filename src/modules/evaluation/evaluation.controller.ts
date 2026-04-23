import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { ApiKeyGuard } from '../../common/guards/api-key.guard';
import { RequiresPermissions } from '../../common/decorators/requires-permissions.decorator';
import { EvaluationService } from './evaluation.service';
import { BulkEvaluateDto, EvaluateDto } from './dto/evaluate.dto';

@ApiTags('Evaluation')
@ApiBearerAuth()
@UseGuards(ApiKeyGuard)
@Controller('evaluate')
export class EvaluationController {
  constructor(private readonly evaluationService: EvaluationService) {}

  /**
   * The primary endpoint: is this flag enabled for this user in this environment?
   * This is what SDKs call on every feature check — must be fast.
   * Results are served from Redis cache (TTL configured via CACHE_TTL_SECONDS).
   */
  @Post(':flagKey')
  @RequiresPermissions('evaluate')
  @ApiOperation({
    summary: 'Evaluate a single flag for a user',
    description:
      'Returns whether the flag is enabled for the given user/environment context. ' +
      'Results are cached in Redis for `CACHE_TTL_SECONDS` seconds. ' +
      'The `reason` field tells you which rule triggered the decision.',
  })
  @ApiParam({ name: 'flagKey', example: 'new-sap-integration' })
  @ApiResponse({
    status: 200,
    description: 'Evaluation result',
    schema: {
      example: {
        flagKey: 'new-sap-integration',
        enabled: true,
        reason: 'RULE_PERCENTAGE',
        cachedAt: '2024-03-10T14:00:00.000Z',
      },
    },
  })
  evaluate(@Param('flagKey') flagKey: string, @Body() dto: EvaluateDto) {
    return this.evaluationService.evaluate(flagKey, dto);
  }

  /**
   * Batch endpoint: evaluate multiple flags in a single round trip.
   * Designed for app bootstrapping — load all flags at startup.
   * Unknown flag keys are returned as { enabled: false } instead of throwing.
   */
  @Post()
  @RequiresPermissions('evaluate')
  @ApiOperation({
    summary: 'Evaluate multiple flags in one request (max 50)',
    description:
      'Efficient bulk evaluation for app initialization. ' +
      'Unknown flag keys are silently returned as disabled.',
  })
  @ApiResponse({
    status: 200,
    description: 'Array of evaluation results, one per requested flag key',
  })
  evaluateBulk(@Body() dto: BulkEvaluateDto) {
    return this.evaluationService.evaluateBulk(dto);
  }
}
