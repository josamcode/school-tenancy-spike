import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { LanguageSwitch } from '../../../components/language-switch';
import { isLang, messages } from '../../../lib/i18n';

export default async function AppLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ lang: string }>;
}) {
  const { lang } = await params;
  if (!isLang(lang)) notFound();
  return (
    <>
      <header className="app-header">
        <a className="app-name" href={`/${lang}`}>
          {messages(lang).appName}
        </a>
        <LanguageSwitch lang={lang} />
      </header>
      <main className="app-main">{children}</main>
    </>
  );
}
