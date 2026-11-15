'use client';

import { usePathname } from 'next/navigation';
import { Lang, LANGUAGE_NAMES, otherLang } from '../lib/i18n';

// The same page in the other language. It is a full page load, because the
// language and the direction are set on the html element.
export function LanguageSwitch({ lang }: { lang: Lang }) {
  const pathname = usePathname();
  const other = otherLang(lang);
  return (
    <a
      href={`/${other}${pathname.slice(lang.length + 1)}`}
      lang={other}
      hrefLang={other}
      data-testid="language-switch"
    >
      {LANGUAGE_NAMES[other]}
    </a>
  );
}
