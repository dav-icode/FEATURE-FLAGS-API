import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
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
import { AuthService } from './auth.service';
import { CreateApiKeyDto, CreatedApiKeyResponse } from './dto/api-key.dto';

@ApiTags('Auth — API Keys')
@ApiBearerAuth()
@UseGuards(ApiKeyGuard)
@Controller('auth/keys')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Get()
  @RequiresPermissions('flags:read')
  @ApiOperation({ summary: 'List all API keys (metadata only — no raw keys)' })
  findAll() {
    return this.authService.findAll();
  }

  @Post()
  @RequiresPermissions('flags:write')
  @ApiOperation({
    summary: 'Create a new API key',
    description:
      '⚠️ The raw key is returned ONLY in this response. It is hashed and never stored in plaintext. ' +
      'Copy it immediately.',
  })
  @ApiResponse({ status: 201, type: CreatedApiKeyResponse })
  create(@Body() dto: CreateApiKeyDto, @CurrentApiKey() caller: string) {
    return this.authService.create(dto, caller);
  }

  @Delete(':id')
  @RequiresPermissions('flags:write')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Revoke an API key immediately',
    description: 'The key stops working on the next request.',
  })
  @ApiParam({ name: 'id', description: 'API key ID' })
  @ApiResponse({ status: 204, description: 'Key revoked' })
  async revoke(@Param('id') id: string, @CurrentApiKey() caller: string) {
    await this.authService.revoke(id, caller);
  }
}
