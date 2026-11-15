import { ExecutionContext, SetMetadata, Type } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { areaOf, isPermission, Permission } from './permissions.js';

const PERMISSION = 'entitlements:permission';

// The one declaration a school route makes. The permission's area decides
// whether the route is core or belongs to a module, and its action is what the
// user must hold in that school.
export const RequiresPermission = (permission: Permission) =>
  SetMetadata(PERMISSION, permission);

export type RouteHandler = ReturnType<ExecutionContext['getHandler']>;

export function declaredPermission(
  reflector: Reflector,
  handler: RouteHandler,
  controller: Type,
): unknown {
  return reflector.getAllAndOverride<unknown>(PERMISSION, [
    handler,
    controller,
  ]);
}

// Returns what is wrong with a route's declaration, or undefined when it is valid.
export function declarationProblem(
  hasSchool: boolean,
  permission: unknown,
): string | undefined {
  if (!hasSchool) {
    return permission === undefined
      ? undefined
      : 'declares a permission but has no schoolId, so it cannot be checked';
  }
  if (permission === undefined) return 'must declare @RequiresPermission()';
  if (!isPermission(permission)) {
    return `declares ${JSON.stringify(permission)}, which is not in the permission list`;
  }
  if (!areaOf(permission)) {
    return `declares "${permission}", whose area is not declared as core or a module`;
  }
  return undefined;
}
