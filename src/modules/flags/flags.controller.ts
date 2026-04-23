import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { ApiKeyGuard } from '../../common/guards/api-key.guard';
import { RequiresPermissions } from '../../common/decorators/requires-permissions.decorator';
import { CurrentApiKey } from '../../common/decorators/current-api-key.decorator';
import { FlagsService } from './flags.service';
import {
  CreateFlagDto,
  CreateRuleDto,
  FlagQueryDto,
  ToggleFlagDto,
  UpdateFlagDto,
} from './dto/flags.dto';

@ApiTags('Flags')
@ApiBearerAuth()
@UseGuards(ApiKeyGuard)
@Controller('flags')
export class FlagsController {
  constructor(private readonly flagsService: FlagsService) {}

  // ── List ──────────────────────────────────────────────────────────

  @Get()
  @RequiresPermissions('flags:read')
  @ApiOperation({ summary: 'List all feature flags' })
  @ApiResponse({ status: 200, description: 'Returns all flags with their rules' })
  findAll(@Query() query: FlagQueryDto) {
    return this.flagsService.findAll(query);
  }

  // ── Get one ───────────────────────────────────────────────────────

  @Get(':key')
  @RequiresPermissions('flags:read')
  @ApiOperation({ summary: 'Get a single flag by key' })
  @ApiParam({ name: 'key', example: 'new-sap-integration' })
  @ApiResponse({ status: 200, description: 'Flag found' })
  @ApiResponse({ status: 404, description: 'Flag not found' })
  findOne(@Param('key') key: string) {
    return this.flagsService.findOne(key);
  }

  // ── Create ────────────────────────────────────────────────────────

  @Post()
  @RequiresPermissions('flags:write')
  @ApiOperation({ summary: 'Create a new feature flag' })
  @ApiResponse({ status: 201, description: 'Flag created' })
  @ApiResponse({ status: 409, description: 'Flag key already exists' })
  create(@Body() dto: CreateFlagDto, @CurrentApiKey() caller: string) {
    return this.flagsService.create(dto, caller);
  }

  // ── Update ────────────────────────────────────────────────────────

  @Patch(':key')
  @RequiresPermissions('flags:write')
  @ApiOperation({ summary: 'Update flag name/description' })
  @ApiParam({ name: 'key', example: 'new-sap-integration' })
  update(
    @Param('key') key: string,
    @Body() dto: UpdateFlagDto,
    @CurrentApiKey() caller: string,
  ) {
    return this.flagsService.update(key, dto, caller);
  }

  // ── Toggle ────────────────────────────────────────────────────────

  @Patch(':key/toggle')
  @RequiresPermissions('flags:write')
  @ApiOperation({
    summary: 'Toggle a flag on or off — this is your kill switch',
    description:
      'Instantly enables/disables a flag for ALL users, bypassing all rules. ' +
      'Cache is invalidated immediately. No deploy required.',
  })
  @ApiParam({ name: 'key', example: 'new-sap-integration' })
  toggle(
    @Param('key') key: string,
    @Body() dto: ToggleFlagDto,
    @CurrentApiKey() caller: string,
  ) {
    return this.flagsService.toggle(key, dto, caller);
  }

  // ── Delete ────────────────────────────────────────────────────────

  @Delete(':key')
  @RequiresPermissions('flags:write')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a flag and all its rules' })
  @ApiParam({ name: 'key', example: 'new-sap-integration' })
  @ApiResponse({ status: 204, description: 'Flag deleted' })
  async remove(@Param('key') key: string, @CurrentApiKey() caller: string) {
    await this.flagsService.remove(key, caller);
  }

  // ── Rules ─────────────────────────────────────────────────────────

  @Post(':key/rules')
  @RequiresPermissions('flags:write')
  @ApiOperation({
    summary: 'Add a targeting rule to a flag',
    description:
      'Rules define WHO sees the flag when it is enabled. ' +
      'Types: USER_LIST, PERCENTAGE, ENVIRONMENT, SCHEDULE',
  })
  @ApiParam({ name: 'key', example: 'new-sap-integration' })
  addRule(
    @Param('key') key: string,
    @Body() dto: CreateRuleDto,
    @CurrentApiKey() caller: string,
  ) {
    return this.flagsService.addRule(key, dto, caller);
  }

  @Delete(':key/rules/:ruleId')
  @RequiresPermissions('flags:write')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Remove a targeting rule from a flag' })
  removeRule(
    @Param('key') key: string,
    @Param('ruleId') ruleId: string,
    @CurrentApiKey() caller: string,
  ) {
    return this.flagsService.removeRule(key, ruleId, caller);
  }
}
