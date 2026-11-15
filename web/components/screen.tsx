import type { ReactNode } from 'react';
import type { Exchange } from '../lib/api';
import type { Lang } from '../lib/i18n';
import { ServerResponse } from './server-response';

// A page of the app: what the user sees, and beside it what the server sent
// back for every call the page made.
export function Screen({
  lang,
  exchanges,
  children,
}: {
  lang: Lang;
  exchanges: Exchange[];
  children: ReactNode;
}) {
  return (
    <div className="proof">
      <div className="screen" data-testid="screen">
        {children}
      </div>
      <ServerResponse exchanges={exchanges} lang={lang} />
    </div>
  );
}
