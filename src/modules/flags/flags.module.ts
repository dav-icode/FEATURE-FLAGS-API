import { Module } from '@nestjs/common';
import { FlagsController } from './flags.controller';
import { FlagsService } from './flags.service';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [AuditModule],
  controllers: [FlagsController],
  providers: [FlagsService],
  exports: [FlagsService],
})
export class FlagsModule {}
