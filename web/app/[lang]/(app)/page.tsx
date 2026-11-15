import { notFound } from 'next/navigation';
import { isLang, messages } from '../../../lib/i18n';

export default async function Home({
  params,
}: {
  params: Promise<{ lang: string }>;
}) {
  const { lang } = await params;
  if (!isLang(lang)) notFound();
  return (
    <>
      <h1>{messages(lang).appName}</h1>
      <p>{messages(lang)['home.intro']}</p>
      {process.env.NODE_ENV !== 'production' && (
        <p>
          <a href={`/${lang}/dev/sign-in`}>Demo</a>
        </p>
      )}
    </>
  );
}
