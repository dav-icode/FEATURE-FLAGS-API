import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsString, ArrayNotEmpty, ArrayMaxSize } from 'class-validator';

export class EvaluateDto {
  @ApiProperty({
    description: 'The user ID to evaluate the flag for. Used for USER_LIST and PERCENTAGE rules.',
    example: 'user_abc123',
  })
  @IsString()
  userId!: string;

  @ApiProperty({
    description: 'Current runtime environment. Used for ENVIRONMENT rules.',
    example: 'production',
  })
  @IsString()
  environment!: string;
}

export class BulkEvaluateDto extends EvaluateDto {
  @ApiProperty({
    description: 'List of flag keys to evaluate in a single request (max 50)',
    example: ['new-sap-integration', 'beta-dashboard', 'dark-mode'],
    maxItems: 50,
  })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  flagKeys!: string[];
}
