import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Request } from 'express';

/**
 * Injects the name of the authenticated API key into a controller method.
 *
 * @example
 * create(@CurrentApiKey() callerName: string) { ... }
 */
export const CurrentApiKey = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string => {
    const request = ctx.switchToHttp().getRequest<Request>();
    return (request as any).apiKeyName ?? 'unknown';
  },
);
