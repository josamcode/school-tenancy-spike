import { Injectable } from '@nestjs/common';
import { EventHandler, HandlesEvent } from '../../src/events/event-handler.js';
import { EventHandlers } from '../../src/events/event-handlers.js';
import { RegistrationFeeHandler } from '../../src/finance/registration-fee.handler.js';
import { startWorker } from '../support/events.js';

@Injectable()
@HandlesEvent('student.accepted', 'transport' as never)
class UndeclaredAreaHandler implements EventHandler {
  async handle() {}
}

@Injectable()
@HandlesEvent('student.expelled' as never, 'finance')
class UnknownEventHandler implements EventHandler {
  async handle() {}
}

@Injectable()
@HandlesEvent('student.accepted', 'finance')
class SecondFeeHandler implements EventHandler {
  async handle() {}
}

describe('event handler declarations', () => {
  it('stop the worker when a handler’s area is not declared as core or a module', async () => {
    await expect(
      startWorker({ providers: [UndeclaredAreaHandler] }),
    ).rejects.toThrow(
      /Invalid event handler declarations:\s+UndeclaredAreaHandler declares the area "transport", which is not declared as core or a module/,
    );
  });

  it('stop the worker when a handler names an event that does not exist', async () => {
    await expect(
      startWorker({ providers: [UnknownEventHandler] }),
    ).rejects.toThrow(
      /UnknownEventHandler handles "student.expelled", which is not an event type/,
    );
  });

  it('stop the worker when two handlers take the same event', async () => {
    await expect(
      startWorker({ providers: [SecondFeeHandler] }),
    ).rejects.toThrow(/"student.accepted" is handled by both/);
  });

  it('let the real worker start, with the fee handler declared for finance', async () => {
    const w = await startWorker();
    try {
      const declared = w.module
        .get(EventHandlers, { strict: false })
        .for('student.accepted');
      expect(declared?.area).toBe('finance');
      expect(declared?.instance).toBeInstanceOf(RegistrationFeeHandler);
    } finally {
      await w.stop();
    }
  });
});
