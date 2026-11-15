import { cookies } from 'next/headers';
import type { Exchange } from './api';

export const ACCEPTED_COOKIE = 'accepted';

// What the API answered to the last acceptance made from this browser, if it
// was for this application. The cookie is set by the server and the page
// cannot be handed one in its address.
export async function acceptanceOf(
  applicationId: string,
): Promise<Exchange | undefined> {
  const raw = (await cookies()).get(ACCEPTED_COOKIE)?.value;
  if (!raw) return undefined;
  try {
    const kept = JSON.parse(raw) as {
      applicationId?: unknown;
      exchange?: Partial<Exchange>;
    };
    const exchange = kept.exchange;
    if (
      kept.applicationId !== applicationId ||
      exchange?.method !== 'POST' ||
      typeof exchange.path !== 'string' ||
      typeof exchange.status !== 'number'
    ) {
      return undefined;
    }
    return {
      method: exchange.method,
      path: exchange.path,
      status: exchange.status,
      body: exchange.body ?? null,
    };
  } catch {
    return undefined;
  }
}
