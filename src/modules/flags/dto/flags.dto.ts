import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { RuleType } from '@prisma/client';

// ──────────────────────────────────────────────────────────────────────────────

export class CreateFlagDto {
  @ApiProperty({
    description: 'Unique machine-readable key used in code. Use kebab-case.',
    example: 'new-sap-integration',
  })
  @IsString()
  @Matches(/^[a-z0-9]+(-[a-z0-9]+)*$/, {
    message: 'Key must be lowercase kebab-case (e.g. new-sap-integration)',
  })
  key!: string;

  @ApiProperty({ example: 'New SAP Integration Module' })
  @IsString()
  name!: string;

  @ApiPropertyOptional({ example: 'Enables the refactored SAP Event Mesh flow' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

// ──────────────────────────────────────────────────────────────────────────────

export class UpdateFlagDto {
  @ApiPropertyOptional({ example: 'Updated Flag Name' })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

// ──────────────────────────────────────────────────────────────────────────────

export class ToggleFlagDto {
  @ApiProperty({ description: 'New enabled state for the flag' })
  @IsBoolean()
  enabled!: boolean;
}

// ──────────────────────────────────────────────────────────────────────────────

export class CreateRuleDto {
  @ApiProperty({ enum: RuleType, example: RuleType.PERCENTAGE })
  @IsEnum(RuleType)
  type!: RuleType;

  @ApiProperty({
    description: 'Rule payload — structure depends on type',
    oneOf: [
      { example: { userIds: ['user_123', 'user_456'] }, description: 'USER_LIST' },
      { example: { percentage: 25 }, description: 'PERCENTAGE (0–100)' },
      { example: { environments: ['production'] }, description: 'ENVIRONMENT' },
      {
        example: { enableAt: '2024-11-29T00:00:00Z', disableAt: '2024-11-30T00:00:00Z' },
        description: 'SCHEDULE',
      },
    ],
  })
  @IsObject()
  value!: Record<string, unknown>;

  @ApiPropertyOptional({
    description: 'Evaluation priority — higher = evaluated first',
    default: 0,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1000)
  priority?: number;
}

// ──────────────────────────────────────────────────────────────────────────────

export class FlagQueryDto {
  @ApiPropertyOptional({ description: 'Filter by enabled state' })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @ApiPropertyOptional({ description: 'Filter flags whose key contains this string' })
  @IsOptional()
  @IsString()
  search?: string;
}
