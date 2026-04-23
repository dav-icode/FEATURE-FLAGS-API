import * as Joi from 'joi';

/**
 * Joi schema that validates all required environment variables at startup.
 * The app will refuse to start if any required variable is missing or invalid.
 */
export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid('development', 'staging', 'production', 'test')
    .default('development'),

  PORT: Joi.number().integer().min(1024).max(65535).default(3000),

  DATABASE_URL: Joi.string().uri({ scheme: ['postgresql', 'postgres'] }).required(),

  REDIS_HOST: Joi.string().hostname().default('localhost'),
  REDIS_PORT: Joi.number().integer().default(6379),
  REDIS_PASSWORD: Joi.string().required(),

  CACHE_TTL_SECONDS: Joi.number().integer().min(1).max(3600).default(30),

  CORS_ORIGINS: Joi.string().default('http://localhost:3000'),
});

/**
 * Typed configuration factory consumed by NestJS ConfigService.
 */
export const configuration = () => ({
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: parseInt(process.env.PORT ?? '3000', 10),

  database: {
    url: process.env.DATABASE_URL,
  },

  redis: {
    host: process.env.REDIS_HOST ?? 'localhost',
    port: parseInt(process.env.REDIS_PORT ?? '6379', 10),
    password: process.env.REDIS_PASSWORD,
  },

  cache: {
    ttlSeconds: parseInt(process.env.CACHE_TTL_SECONDS ?? '30', 10),
  },

  cors: {
    origins: (process.env.CORS_ORIGINS ?? 'http://localhost:3000')
      .split(',')
      .map((o) => o.trim()),
  },
});

export type AppConfig = ReturnType<typeof configuration>;
