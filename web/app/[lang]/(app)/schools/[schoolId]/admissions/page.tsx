import { notFound } from 'next/navigation';
import { ApiError } from '../../../../../../components/api-error';
import { Screen } from '../../../../../../components/screen';
import { getApplications, getMySchools } from '../../../../../../lib/api';
import { isLang, messages } from '../../../../../../lib/i18n';
import { accept } from './actions';

export default async function Admissions({
  params,
}: {
  params: Promise<{ lang: string; schoolId: string }>;
}) {
  const { lang, schoolId } = await params;
  if (!isLang(lang)) notFound();
  const text = messages(lang);

  const [schools, applications] = await Promise.all([
    getMySchools(),
    getApplications(schoolId),
  ]);

  return (
    <Screen lang={lang} exchanges={[applications.exchange, schools.exchange]}>
      <h1>{text['admissions.title']}</h1>
      {!applications.ok ? (
        <ApiError
          status={applications.status}
          problem={applications.problem}
          lang={lang}
        />
      ) : (
        <>
          <h2>{text['admissions.applications']}</h2>
          {applications.data.length === 0 ? (
            <p>{text['admissions.empty']}</p>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>{text['admissions.applicant']}</th>
                    <th>{text['admissions.status']}</th>
                    <th>{text['admissions.action']}</th>
                  </tr>
                </thead>
                <tbody>
                  {applications.data.map((application) => {
                    const pending = application.status === 'pending';
                    return (
                      <tr
                        key={application.id}
                        data-testid="application"
                        data-application={application.id}
                        data-status={application.status}
                      >
                        <td>
                          <bdi>{application.applicantName}</bdi>
                        </td>
                        <td>
                          {pending
                            ? text['admissions.pending']
                            : text['admissions.accepted']}
                        </td>
                        <td>
                          {pending ? (
                            <form action={accept}>
                              <input type="hidden" name="lang" value={lang} />
                              <input
                                type="hidden"
                                name="schoolId"
                                value={schoolId}
                              />
                              <input
                                type="hidden"
                                name="applicationId"
                                value={application.id}
                              />
                              <button type="submit" data-testid="accept">
                                {text['admissions.accept']}
                              </button>
                            </form>
                          ) : (
                            <a
                              href={`/${lang}/schools/${schoolId}/admissions/${application.id}`}
                              data-testid="follow"
                            >
                              {text['admissions.follow']}
                            </a>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </Screen>
  );
}
