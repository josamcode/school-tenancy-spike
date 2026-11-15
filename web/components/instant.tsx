import { formatInstant } from '../lib/format';
import type { Lang } from '../lib/i18n';

// A moment the API gave in UTC, shown in the school's own time. The element
// keeps the instant as it came.
export function Instant({
  at,
  timeZone,
  lang,
}: {
  at: string;
  timeZone: string;
  lang: Lang;
}) {
  return <time dateTime={at}>{formatInstant(at, timeZone, lang)}</time>;
}
