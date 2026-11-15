import { ExecutionContext, SetMetadata, Type } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ModuleKey } from './modules.js';

const CORE = 'entitlements:core';
const MODULE = 'entitlements:module';

// Core routes are always on and are never checked against tenant_modules.
export const Core = () => SetMetadata(CORE, true);

// The route answers only when the school has this module switched on.
export const RequiresModule = (module: ModuleKey) =>
  SetMetadata(MODULE, module);

export interface RouteDeclaration {
  core: boolean;
  module?: ModuleKey;
}

export type RouteHandler = ReturnType<ExecutionContext['getHandler']>;

export function declarationOf(
  reflector: Reflector,
  handler: RouteHandler,
  controller: Type,
): RouteDeclaration {
  const targets = [handler, controller];
  return {
    core: reflector.getAllAndOverride<boolean>(CORE, targets) === true,
    module: reflector.getAllAndOverride<ModuleKey>(MODULE, targets),
  };
}

// Returns what is wrong with a route's declaration, or undefined when it is valid.
export function declarationProblem(
  hasSchool: boolean,
  { core, module }: RouteDeclaration,
): string | undefined {
  if (!hasSchool) {
    return module
      ? 'declares a module but has no schoolId, so the module cannot be checked'
      : undefined;
  }
  if (core && module) return 'declares both @Core() and @RequiresModule()';
  if (!core && !module) return 'must declare @Core() or @RequiresModule()';
  return undefined;
}
