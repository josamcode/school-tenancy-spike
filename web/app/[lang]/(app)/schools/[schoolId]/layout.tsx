import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { SchoolBar } from '../../../../../components/school-bar';
import { getMySchools } from '../../../../../lib/api';
import { isLang, messages, pickText } from '../../../../../lib/i18n';

export default async function SchoolLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ lang: string; schoolId: string }>;
}) {
  const { lang, schoolId } = await params;
  if (!isLang(lang)) notFound();
  const text = messages(lang);

  // The API lists the user's own schools and no other.
  const schools = await getMySchools();
  const choices = (schools.ok ? schools.data : []).map((school) => {
    const name = pickText(school.nameI18n, lang, school.name)!;
    return { id: school.id, name: name.text, lang: name.lang };
  });

  return (
    <>
      <SchoolBar
        lang={lang}
        schoolId={schoolId}
        schools={choices}
        labels={{
          schools: text['schools.label'],
          pages: text['nav.label'],
          students: text['nav.students'],
          permissions: text['nav.permissions'],
          invoices: text['nav.invoices'],
          ledger: text['nav.ledger'],
          admissions: text['nav.admissions'],
        }}
      />
      {children}
    </>
  );
}
