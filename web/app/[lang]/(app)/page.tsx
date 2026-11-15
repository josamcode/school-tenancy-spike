import { notFound } from 'next/navigation';
import { ApiError } from '../../../components/api-error';
import { Screen } from '../../../components/screen';
import { getMySchools } from '../../../lib/api';
import { isLang, messages, pickText } from '../../../lib/i18n';

export default async function Home({
  params,
}: {
  params: Promise<{ lang: string }>;
}) {
  const { lang } = await params;
  if (!isLang(lang)) notFound();
  const text = messages(lang);
  const schools = await getMySchools();

  return (
    <Screen lang={lang} exchanges={[schools.exchange]}>
      <h1>{text.appName}</h1>
      <p className="lead">{text['home.intro']}</p>
      {schools.ok ? (
        <>
          <h2>{text['schools.label']}</h2>
          {schools.data.length === 0 ? (
            <p>{text['schools.none']}</p>
          ) : (
            <ul className="link-list">
              {schools.data.map((school) => {
                const name = pickText(school.nameI18n, lang, school.name)!;
                return (
                  <li key={school.id}>
                    <a
                      href={`/${lang}/schools/${school.id}`}
                      data-testid="my-school"
                    >
                      <bdi lang={name.lang}>{name.text}</bdi>
                    </a>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      ) : (
        <ApiError
          status={schools.status}
          problem={schools.problem}
          lang={lang}
        />
      )}
      {process.env.NODE_ENV !== 'production' && (
        <p className="note">
          <a href={`/${lang}/dev/sign-in`}>
            {lang === 'ar' ? 'الدخول كمستخدم تجريبي' : 'Sign in as a demo user'}
          </a>
        </p>
      )}
    </Screen>
  );
}
