import { SetMetadata } from '@nestjs/common';

export const PERMISSIONS_KEY = 'permissions';

/**
 * Declares which API key permissions are required to access a route.
 *
 * @example
 * @RequiresPermissions('flags:write')
 * @Post()
 * create() { ... }
 */
export const RequiresPermissions = (...permissions: string[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);
