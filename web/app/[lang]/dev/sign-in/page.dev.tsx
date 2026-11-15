import { notFound } from 'next/navigation';
import { demoGuide } from '../../../../dev/demo-guide';
import { isLang } from '../../../../lib/i18n';
import { signInAsSeedUser } from './actions.dev';

// A route in development only: next.config.ts leaves *.dev.tsx files out of
// a production build. It is also the demo guide: one group per proof.
export default async function DemoSignIn({
  params,
}: {
  params: Promise<{ lang: string }>;
}) {
  const { lang } = await params;
  if (!isLang(lang)) notFound();
  return (
    <main className="app-main">
      <p className="notice" data-testid="demo-notice">
        <strong>Demo sign-in.</strong> Development only. There is no identity
        provider yet, so this page signs you in as a seed user.{' '}
        <span lang="ar" dir="rtl">
          للتجربة فقط، في بيئة التطوير.
        </span>
      </p>
      {demoGuide.map((group) => (
        <section
          key={group.id}
          className="guide-group"
          data-testid="guide-group"
          data-group={group.id}
        >
          <h2>{group.title[lang]}</h2>
          <ul className="choices">
            {group.entries.map((entry) => (
              <li key={entry.id}>
                <form action={signInAsSeedUser}>
                  <input type="hidden" name="lang" value={lang} />
                  <input type="hidden" name="entry" value={entry.id} />
                  <button
                    type="submit"
                    data-testid="sign-in-as"
                    data-entry={entry.id}
                    data-user={entry.userId}
                    data-school={entry.schoolId}
                  >
                    <bdi dir="ltr">{entry.email}</bdi>
                    <small>{entry.shows[lang]}</small>
                  </button>
                </form>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </main>
  );
}
