import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayNotEmpty,
  IsArray,
  IsDateString,
  IsOptional,
  IsString,
  Matches,
} from 'class-validator';

const VALID_PERMISSIONS = ['flags:read', 'flags:write', 'evaluate', 'audit:read'];

export class CreateApiKeyDto {
  @ApiProperty({
    description: 'Human-readable label for this key',
    example: 'Production SDK Key',
  })
  @IsString()
  name!: string;

  @ApiProperty({
    description: `Scoped permissions. Valid values: ${VALID_PERMISSIONS.join(', ')}`,
    example: ['flags:read', 'evaluate'],
    isArray: true,
  })
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  @Matches(
    new RegExp(`^(${VALID_PERMISSIONS.join('|')})$`),
    { each: true, message: `Each permission must be one of: ${VALID_PERMISSIONS.join(', ')}` },
  )
  permissions!: string[];

  @ApiPropertyOptional({
    description: 'Optional ISO 8601 expiry date. Omit for a non-expiring key.',
    example: '2025-12-31T23:59:59Z',
  })
  @IsOptional()
  @IsDateString()
  expiresAt?: string;
}

export class CreatedApiKeyResponse {
  @ApiProperty({ description: 'Internal key ID' })
  id!: string;

  @ApiProperty({ description: 'Key name' })
  name!: string;

  @ApiProperty({
    description:
      '⚠️  IMPORTANT: This is the ONLY time the raw key is returned. Store it securely.',
    example: 'ff_a1b2c3d4e5f6...',
  })
  key!: string;

  @ApiProperty({ description: 'Granted permissions' })
  permissions!: string[];

  @ApiPropertyOptional({ description: 'Expiry date, if set' })
  expiresAt?: string;
}
