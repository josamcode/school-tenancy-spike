// Must match the check on outbox_events.type.
export const EVENT_TYPES = ['student.accepted'] as const;

export type EventType = (typeof EVENT_TYPES)[number];

export interface EventPayloads {
  'student.accepted': {
    applicationId: string;
    studentId: string;
    // The instant of the acceptance, in UTC.
    acceptedAt: string;
  };
}

export function isEventType(value: unknown): value is EventType {
  return (EVENT_TYPES as readonly unknown[]).includes(value);
}

// What a job carries. The payload stays in the outbox, under the school's
// row-level security.
export interface EventRef {
  eventId: string;
  tenantId: string;
}

export interface OutboxEvent {
  id: string;
  type: string;
  payload: unknown;
  actorUserId: string;
  createdAt: Date;
}
