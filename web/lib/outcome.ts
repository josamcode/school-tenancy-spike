import type { Exchange } from './api';
import type { Messages } from './i18n';

export type Outcome = 'allowed' | 'refused';

export const outcomeOf = (status: number): Outcome =>
  status >= 200 && status < 300 ? 'allowed' : 'refused';

// The code the API gives a refusal, when it gives one.
export function codeOf(exchange: Exchange): string | undefined {
  const code = (exchange.body as { code?: unknown } | null)?.code;
  return typeof code === 'string' ? code : undefined;
}

// Why a call was refused, in the same words on every screen.
export function reasonOf(exchange: Exchange, text: Messages): string {
  const code = codeOf(exchange);
  if (code === 'MODULE_DISABLED') return text['reason.moduleDisabled'];
  if (code === 'PERMISSION_DENIED') return text['reason.permissionDenied'];
  if (exchange.status === 401) return text['reason.notSignedIn'];
  if (exchange.status === 403) return text['reason.notYourSchool'];
  return text['reason.other'];
}

export const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isZero = (amount: string) => /^-?0(\.0+)?$/.test(amount);
