import { SetMetadata } from '@nestjs/common';
import { Area } from '../entitlements/areas.js';
import { EventType, OutboxEvent } from './event-types.js';

export const HANDLES_EVENT = 'events:handles';

export interface HandlerDeclaration {
  type: EventType;
  area: Area;
}

export interface EventHandler {
  handle(event: OutboxEvent): Promise<void>;
}

// The one declaration an event handler makes, like @RequiresPermission on a
// route. The area decides which module must be on for the handler to run. A
// class without it is never called.
export const HandlesEvent = (type: EventType, area: Area) =>
  SetMetadata(HANDLES_EVENT, { type, area } satisfies HandlerDeclaration);
