import { NestFactory } from '@nestjs/core';
import { ValidationPipe, VersioningType } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { AppConfig } from './config/configuration';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    // Suppress NestJS banner in production
    logger: process.env.NODE_ENV === 'production'
      ? ['error', 'warn', 'log']
      : ['error', 'warn', 'log', 'debug', 'verbose'],
  });

  const config = app.get(ConfigService<AppConfig, true>);

  // ── Security headers ───────────────────────────────────────────────
  app.use(
    helmet({
      crossOriginEmbedderPolicy: false, // allow Swagger UI
    }),
  );

  // ── CORS ───────────────────────────────────────────────────────────
  app.enableCors({
    origin: config.get('cors', { infer: true }).origins,
    methods: ['GET', 'POST', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });

  // ── Global validation pipe ─────────────────────────────────────────
  // - whitelist: strips unknown properties from request body
  // - forbidNonWhitelisted: rejects requests with unknown properties
  // - transform: auto-converts request params to their declared types
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  // ── Global prefix ──────────────────────────────────────────────────
  app.setGlobalPrefix('api/v1');

  // ── Swagger documentation ──────────────────────────────────────────
  if (config.get('nodeEnv') !== 'production') {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('Feature Flags API')
      .setDescription(
        'A production-ready Feature Flags service with Redis caching, ' +
        'deterministic percentage rollouts, audit logging, and scoped API key auth.\n\n' +
        '**Authentication:** All endpoints require `Authorization: Bearer <api_key>` header.\n\n' +
        '**Getting started:** Run the seed script to get your first API key.',
      )
      .setVersion('1.0.0')
      .addBearerAuth()
      .addTag('Evaluation', 'Check if a flag is enabled for a user')
      .addTag('Flags', 'Create and manage feature flags and targeting rules')
      .addTag('Audit', 'Immutable history of every flag change')
      .addTag('Auth — API Keys', 'Manage scoped API keys')
      .build();

    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('docs', app, document, {
      swaggerOptions: { persistAuthorization: true },
    });
  }

  // ── Start ──────────────────────────────────────────────────────────
  const port = config.get('port', { infer: true });
  await app.listen(port);

  console.log(`\n🚀 Feature Flags API running on http://localhost:${port}/api/v1`);
  if (config.get('nodeEnv') !== 'production') {
    console.log(`📖 Swagger docs at http://localhost:${port}/docs\n`);
  }
}

bootstrap();
