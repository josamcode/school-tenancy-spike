import { notFound } from 'next/navigation';
import { Screen } from '../../../../../components/screen';
import {
  getApplications,
  getInvoices,
  getLedger,
  getMySchools,
  getStudents,
} from '../../../../../lib/api';
import { isLang, messages } from '../../../../../lib/i18n';
import { codeOf, outcomeOf, reasonOf } from '../../../../../lib/outcome';

// What the server allows this user in this school. Each row is a real call to
// the page it names, and says what the server answered. The same page shows
// which modules a school has: a module that is off refuses everyone.
export default async function Permissions({
  params,
}: {
  params: Promise<{ lang: string; schoolId: string }>;
}) {
  const { lang, schoolId } = await params;
  if (!isLang(lang)) notFound();
  const text = messages(lang);

  const [schools, students, invoices, ledger, applications] = await Promise.all(
    [
      getMySchools(),
      getStudents(schoolId),
      getInvoices(schoolId),
      getLedger(schoolId),
      getApplications(schoolId),
    ],
  );
  const rows = [
    {
      area: 'students',
      page: text['nav.students'],
      part: text['permissions.core'],
      path: '/students',
      exchange: students.exchange,
    },
    {
      area: 'invoices',
      page: text['nav.invoices'],
      part: text['permissions.financeModule'],
      path: '/invoices',
      exchange: invoices.exchange,
    },
    {
      area: 'ledger',
      page: text['nav.ledger'],
      part: text['permissions.financeModule'],
      path: '/ledger',
      exchange: ledger.exchange,
    },
    {
      area: 'admissions',
      page: text['nav.admissions'],
      part: text['permissions.admissionsModule'],
      path: '/admissions',
      exchange: applications.exchange,
    },
  ];

  const mine = schools.ok
    ? schools.data.find((school) => school.id === schoolId)
    : undefined;
  const roleName =
    mine?.role === 'school_admin'
      ? text['role.school_admin']
      : mine?.role === 'staff'
        ? text['role.staff']
        : mine?.role;

  return (
    <Screen
      lang={lang}
      exchanges={[...rows.map((row) => row.exchange), schools.exchange]}
    >
      <h1>{text['permissions.title']}</h1>
      <p className="lead">{text['permissions.intro']}</p>
      <dl className="facts">
        <div>
          <dt>{text['role.label']}</dt>
          <dd
            data-testid="access-role"
            data-role={mine?.role ?? undefined}
            data-grants={
              mine?.grants.length ? mine.grants.join(' ') : undefined
            }
          >
            {roleName ??
              (mine?.grants.length ? (
                <>
                  {text['role.grant']}{' '}
                  <bdi dir="ltr">{mine.grants.join(', ')}</bdi>
                </>
              ) : (
                text['role.none']
              ))}
          </dd>
        </div>
      </dl>

      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>{text['permissions.page']}</th>
              <th>{text['permissions.belongsTo']}</th>
              <th>{text['response.title']}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const outcome = outcomeOf(row.exchange.status);
              return (
                <tr
                  key={row.area}
                  data-testid="area-row"
                  data-area={row.area}
                  data-outcome={outcome}
                  data-status={row.exchange.status}
                  data-code={codeOf(row.exchange)}
                >
                  <td>
                    <a href={`/${lang}/schools/${schoolId}${row.path}`}>
                      {row.page}
                    </a>
                  </td>
                  <td>{row.part}</td>
                  <td>
                    <strong className={outcome} data-testid="area-outcome">
                      {text[`response.${outcome}`]}
                    </strong>
                    {outcome === 'refused' && (
                      <> {reasonOf(row.exchange, text)}</>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="note" data-testid="module-note">
        {text['permissions.moduleNote']}
      </p>
    </Screen>
  );
}
