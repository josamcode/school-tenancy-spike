import { notFound } from 'next/navigation';
import { seedUsers } from '../../../../dev/seed-users';
import { isLang } from '../../../../lib/i18n';
import { signInAsSeedUser } from './actions.dev';

// A route in development only: next.config.ts leaves *.dev.tsx files out of
// a production build.
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
      <ul className="choices">
        {seedUsers.map((user) => (
          <li key={`${user.userId} ${user.schoolId}`}>
            <form action={signInAsSeedUser}>
              <input type="hidden" name="lang" value={lang} />
              <input type="hidden" name="userId" value={user.userId} />
              <input type="hidden" name="schoolId" value={user.schoolId} />
              <button
                type="submit"
                data-testid="sign-in-as"
                data-user={user.userId}
                data-school={user.schoolId}
              >
                <bdi dir="ltr">{user.email}</bdi>
                <small dir="ltr">{user.shows}</small>
              </button>
            </form>
          </li>
        ))}
      </ul>
    </main>
  );
}
