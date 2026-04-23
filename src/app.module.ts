import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { configuration, envValidationSchema } from './config/configuration';
import { PrismaModule } from './prisma/prisma.module';
import { RedisModule } from './redis/redis.module';
import { FlagsModule } from './modules/flags/flags.module';
import { EvaluationModule } from './modules/evaluation/evaluation.module';
import { AuditModule } from './modules/audit/audit.module';
import { AuthModule } from './modules/auth/auth.module';
import { ApiKeyGuard } from './common/guards/api-key.guard';
import { GlobalExceptionFilter } from './common/filters/http-exception.filter';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';

@Module({
  imports: [
    // Config — validated at startup, available globally
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      validationSchema: envValidationSchema,
      validationOptions: { abortEarly: false },
    }),

    // Rate limiting — 100 requests per minute per IP by default
    ThrottlerModule.forRoot([
      {
        ttl: 60_000,
        limit: 100,
      },
    ]),

    // Infrastructure
    PrismaModule,
    RedisModule,

    // Feature modules
    FlagsModule,
    EvaluationModule,
    AuditModule,
    AuthModule,
  ],
  providers: [
    // Global exception handler — consistent error envelopes
    {
      provide: APP_FILTER,
      useClass: GlobalExceptionFilter,
    },
    // Global request/response logger
    {
      provide: APP_INTERCEPTOR,
      useClass: LoggingInterceptor,
    },
  ],
})
export class AppModule {}
