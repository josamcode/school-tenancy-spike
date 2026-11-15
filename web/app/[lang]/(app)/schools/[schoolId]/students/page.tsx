import { notFound } from 'next/navigation';
import { ApiError } from '../../../../../../components/api-error';
import { Screen } from '../../../../../../components/screen';
import { getMySchools, getStudents } from '../../../../../../lib/api';
import { isLang, messages } from '../../../../../../lib/i18n';
import { UUID } from '../../../../../../lib/outcome';

export default async function Students({
  params,
  searchParams,
}: {
  params: Promise<{ lang: string; schoolId: string }>;
  searchParams: Promise<{ try?: string | string[] }>;
}) {
  const { lang, schoolId } = await params;
  if (!isLang(lang)) notFound();
  const text = messages(lang);

  // The id of a school to try, offered by the demo guide. The API will not
  // list a school that is not the user's, so it cannot come from there.
  const offered = (await searchParams).try;
  const other =
    typeof offered === 'string' && UUID.test(offered) ? offered : '';

  const [schools, students] = await Promise.all([
    getMySchools(),
    getStudents(schoolId),
  ]);

  return (
    <Screen lang={lang} exchanges={[schools.exchange, students.exchange]}>
      <h1>{text['students.title']}</h1>
      {!students.ok ? (
        <ApiError
          status={students.status}
          problem={students.problem}
          lang={lang}
        />
      ) : students.data.length === 0 ? (
        <p>{text['students.empty']}</p>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>{text['students.name']}</th>
              </tr>
            </thead>
            <tbody>
              {students.data.map((student) => (
                <tr key={student.id} data-testid="student-row">
                  <td>
                    <bdi>{student.fullName}</bdi>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h2>{text['students.otherSchool']}</h2>
      <p className="lead">{text['students.otherSchoolHelp']}</p>
      <form
        className="inline-form"
        method="get"
        action={`/${lang}/open-school`}
      >
        <label>
          {text['students.schoolId']}
          <input
            name="school"
            defaultValue={other}
            dir="ltr"
            required
            autoComplete="off"
            data-testid="open-school-id"
          />
        </label>
        <button type="submit" data-testid="open-school">
          {text['students.open']}
        </button>
      </form>
    </Screen>
  );
}
