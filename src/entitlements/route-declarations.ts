import {
  Injectable,
  OnApplicationBootstrap,
  RequestMethod,
  Type,
} from '@nestjs/common';
import { DiscoveryService, MetadataScanner, Reflector } from '@nestjs/core';
import {
  declarationOf,
  declarationProblem,
  RouteHandler,
} from './decorators.js';

// The metadata keys Nest's route decorators write.
const PATH = 'path';
const METHOD = 'method';

const paths = (value: unknown): string[] =>
  (Array.isArray(value) ? value : [value ?? '']).map(String);

const join = (...parts: string[]) =>
  '/' +
  parts
    .flatMap((part) => part.split('/'))
    .filter(Boolean)
    .join('/');

// Stops the app from starting when a route's module declaration is missing or wrong.
@Injectable()
export class RouteDeclarations implements OnApplicationBootstrap {
  constructor(
    private readonly discovery: DiscoveryService,
    private readonly scanner: MetadataScanner,
    private readonly reflector: Reflector,
  ) {}

  onApplicationBootstrap() {
    const problems: string[] = [];

    for (const wrapper of this.discovery.getControllers()) {
      const controller = wrapper.metatype as Type;
      const prototype = controller.prototype as Record<string, RouteHandler>;

      for (const name of this.scanner.getAllMethodNames(prototype)) {
        const handler = prototype[name];
        const method = Reflect.getMetadata(METHOD, handler) as
          RequestMethod | undefined;
        if (method === undefined) continue;

        const declaration = declarationOf(this.reflector, handler, controller);
        for (const prefix of paths(Reflect.getMetadata(PATH, controller))) {
          for (const suffix of paths(Reflect.getMetadata(PATH, handler))) {
            const path = join(prefix, suffix);
            const hasSchool = path.split('/').includes(':schoolId');
            const problem = declarationProblem(hasSchool, declaration);
            if (problem) {
              problems.push(
                `${RequestMethod[method]} ${path} (${controller.name}.${name}) ${problem}`,
              );
            }
          }
        }
      }
    }

    if (problems.length > 0) {
      throw new Error(`Invalid route declarations:\n${problems.join('\n')}`);
    }
  }
}
