import { Injectable, OnModuleInit } from '@nestjs/common';
import { DiscoveryService } from '@nestjs/core';
import { Area, isArea } from '../entitlements/areas.js';
import {
  EventHandler,
  HandlerDeclaration,
  HANDLES_EVENT,
} from './event-handler.js';
import { isEventType } from './event-types.js';

export interface DeclaredHandler {
  name: string;
  area: Area;
  instance: EventHandler;
}

// Finds every declared handler and stops the worker from starting when a
// declaration is wrong. The runner calls handlers only through this class.
@Injectable()
export class EventHandlers implements OnModuleInit {
  private readonly byType = new Map<string, DeclaredHandler>();

  constructor(private readonly discovery: DiscoveryService) {}

  onModuleInit() {
    const problems: string[] = [];

    for (const wrapper of this.discovery.getProviders()) {
      const { metatype, instance } = wrapper;
      if (typeof metatype !== 'function' || !instance) continue;
      const declared = Reflect.getMetadata(HANDLES_EVENT, metatype) as
        Partial<HandlerDeclaration> | undefined;
      if (declared === undefined) continue;

      const name = metatype.name;
      const { type, area } = declared;
      if (!isEventType(type)) {
        problems.push(
          `${name} handles ${JSON.stringify(type)}, which is not an event type`,
        );
        continue;
      }
      if (typeof area !== 'string' || !isArea(area)) {
        problems.push(
          `${name} declares the area ${JSON.stringify(area)}, which is not declared as core or a module`,
        );
        continue;
      }
      const other = this.byType.get(type);
      if (other) {
        problems.push(
          `"${type}" is handled by both ${other.name} and ${name}, and an event goes to one handler`,
        );
        continue;
      }
      this.byType.set(type, { name, area, instance: instance as EventHandler });
    }

    if (problems.length > 0) {
      throw new Error(
        `Invalid event handler declarations:\n${problems.join('\n')}`,
      );
    }
  }

  for(type: string): DeclaredHandler | undefined {
    return this.byType.get(type);
  }
}
