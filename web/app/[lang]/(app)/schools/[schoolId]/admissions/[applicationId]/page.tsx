import { notFound } from 'next/navigation';
import { ApiError } from '../../../../../../../components/api-error';
import { AutoRefresh } from '../../../../../../../components/auto-refresh';
import { Money } from '../../../../../../../components/money';
import { Screen } from '../../../../../../../components/screen';
import { acceptanceOf } from '../../../../../../../lib/accepted';
import {
  getApplicationEvent,
  getApplications,
  getLedger,
  getMySchools,
} from '../../../../../../../lib/api';
import { formatInstant } from '../../../../../../../lib/format';
import { isLang, messages } from '../../../../../../../lib/i18n';
import { receiverRecords } from '../../../../../../../lib/receiver';

type State = 'done' | 'waiting' | 'failed';

// Follows one acceptance: the event it wrote, where the worker routed it, and
// what came of it. While something is still expected, the page asks the API
// again once a second.
export default async function ApplicationTrail({
  params,
}: {
  params: Promise<{ lang: string; schoolId: string; applicationId: string }>;
}) {
  const { lang, schoolId, applicationId } = await params;
  if (!isLang(lang)) notFound();
  const text = messages(lang);
  const back = `/${lang}/schools/${schoolId}/admissions`;

  const [schools, applications, posted] = await Promise.all([
    getMySchools(),
    getApplications(schoolId),
    acceptanceOf(applicationId),
  ]);
  const first = [...(posted ? [posted] : []), schools.exchange];
  if (!applications.ok) {
    return (
      <Screen lang={lang} exchanges={[...first, applications.exchange]}>
        <h1>{text['admissions.title']}</h1>
        <ApiError
          status={applications.status}
          problem={applications.problem}
          lang={lang}
        />
      </Screen>
    );
  }
  const application = applications.data.find((row) => row.id === applicationId);
  if (!application) {
    return (
      <Screen lang={lang} exchanges={[...first, applications.exchange]}>
        <h1>{text['admissions.title']}</h1>
        <ApiError status={404} problem={{}} lang={lang} />
      </Screen>
    );
  }

  const event = await getApplicationEvent(schoolId, applicationId);
  const trail = event.ok ? event.data : undefined;
  // The fee is finance's, so it is read from the ledger, as the same user.
  const ledger =
    trail?.routedTo === 'finance' ? await getLedger(schoolId) : undefined;
  const fee = ledger?.ok
    ? ledger.data.studentBalances.find(
        (row) => row.studentId === application.studentId,
      )
    : undefined;
  const records =
    trail?.routedTo === 'webhook'
      ? await receiverRecords(trail.event.id)
      : undefined;

  const accepted = application.status === 'accepted';
  const delivery = trail?.delivery ?? null;
  const outcome: State = trail?.failure
    ? 'failed'
    : trail?.routedTo === 'finance'
      ? fee
        ? 'done'
        : ledger && !ledger.ok
          ? 'failed'
          : 'waiting'
      : delivery?.status === 'delivered'
        ? 'done'
        : delivery?.status === 'failed'
          ? 'failed'
          : 'waiting';
  // Nothing more will change once the outcome is known, or while the
  // application is still pending.
  const settled = !accepted || outcome !== 'waiting';

  return (
    <Screen
      lang={lang}
      exchanges={[
        ...first,
        applications.exchange,
        event.exchange,
        ...(ledger ? [ledger.exchange] : []),
      ]}
    >
      <AutoRefresh active={!settled} />
      <nav className="actions">
        <a href={back}>{text['admissions.back']}</a>
      </nav>
      <h1>
        {text['trail.title'].split('{name}')[0]}
        <bdi>{application.applicantName}</bdi>
        {text['trail.title'].split('{name}')[1]}
      </h1>
      <p className="lead">{text['trail.intro']}</p>

      <ol className="trail" data-testid="trail" data-event={trail?.event.id}>
        <li
          className="trail-step"
          data-testid="trail-step"
          data-step="accepted"
          data-state={accepted ? 'done' : 'waiting'}
        >
          <p className="trail-title">
            {accepted ? text['trail.accepted'] : text['trail.notAccepted']}
          </p>
          {application.acceptedAt && (
            <p>{formatInstant(application.acceptedAt, lang)}</p>
          )}
        </li>

        <li
          className="trail-step"
          data-testid="trail-step"
          data-step="dispatched"
          data-state={trail?.event.dispatchedAt ? 'done' : 'waiting'}
        >
          <p className="trail-title">
            {trail?.event.dispatchedAt
              ? text['trail.dispatched']
              : text['trail.waiting']}
          </p>
          {trail?.event.dispatchedAt && (
            <p>{formatInstant(trail.event.dispatchedAt, lang)}</p>
          )}
        </li>

        <li
          className="trail-step"
          data-testid="trail-step"
          data-step="routed"
          data-state={trail?.routedTo ? 'done' : 'waiting'}
          data-routed-to={trail?.routedTo ?? undefined}
        >
          <p className="trail-title">
            {trail?.routedTo === 'finance'
              ? text['trail.routedToFinance']
              : trail?.routedTo === 'webhook'
                ? text['trail.routedToWebhook']
                : text['trail.waiting']}
          </p>
          {trail?.routedAt && <p>{formatInstant(trail.routedAt, lang)}</p>}
        </li>

        <li
          className="trail-step"
          data-testid="trail-step"
          data-step="outcome"
          data-state={outcome}
        >
          {trail?.failure ? (
            <>
              <p className="trail-title">
                <strong className="refused">{text['trail.failed']}</strong>
              </p>
              <p>
                <bdi dir="ltr">{trail.failure.error}</bdi>
              </p>
            </>
          ) : trail?.routedTo === 'finance' ? (
            fee ? (
              <p className="trail-title">
                {text['trail.feePosted']}{' '}
                <span data-testid="fee-amount">
                  <Money amount={fee.balance} currency={fee.currency} />
                </span>
              </p>
            ) : ledger && !ledger.ok ? (
              <ApiError
                status={ledger.status}
                problem={ledger.problem}
                lang={lang}
              />
            ) : (
              <p className="trail-title">{text['trail.feeWaiting']}</p>
            )
          ) : delivery ? (
            <>
              <p className="trail-title">
                {delivery.status === 'delivered' ? (
                  text['trail.delivered']
                ) : delivery.status === 'failed' ? (
                  <strong className="refused">
                    {text['trail.deliveryFailed']}
                  </strong>
                ) : (
                  text['trail.deliveryPending']
                )}
              </p>
              {delivery.url && (
                <p>
                  {text['trail.endpoint']} <bdi dir="ltr">{delivery.url}</bdi>
                </p>
              )}
              {delivery.finishedAt && (
                <p>{formatInstant(delivery.finishedAt, lang)}</p>
              )}
            </>
          ) : (
            <p className="trail-title">{text['trail.waiting']}</p>
          )}
        </li>
      </ol>

      {delivery && delivery.attempts.length > 0 && (
        <>
          <h2>{text['trail.attempts']}</h2>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>{text['trail.attempt']}</th>
                  <th>{text['trail.time']}</th>
                  <th>{text['trail.response']}</th>
                </tr>
              </thead>
              <tbody>
                {delivery.attempts.map((attempt) => (
                  <tr
                    key={attempt.attemptNo}
                    data-testid="attempt"
                    data-attempt={attempt.attemptNo}
                    data-response={attempt.responseStatus ?? undefined}
                  >
                    <td className="number">{attempt.attemptNo}</td>
                    <td>{formatInstant(attempt.startedAt, lang)}</td>
                    <td>
                      {attempt.responseStatus ?? (
                        <>
                          {text['trail.noResponse']}{' '}
                          <bdi dir="ltr">{attempt.error}</bdi>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {records && records.length > 0 && (
        <section
          data-testid="receiver-record"
          data-signature={
            records.some(
              (record) =>
                record.signatureValid && record.verdict === 'accepted',
            )
              ? 'valid'
              : 'invalid'
          }
        >
          <h2>{text['receiver.title']}</h2>
          <p className="note">{text['receiver.developmentOnly']}</p>
          <div className="table-wrap">
            <table className="table">
              <tbody>
                {records.map((record, index) => (
                  <tr key={index}>
                    <td>{formatInstant(record.receivedAt, lang)}</td>
                    <td>{text[`receiver.${record.verdict}`]}</td>
                    <td>
                      {record.signatureValid ? (
                        <strong>{text['receiver.signatureValid']}</strong>
                      ) : (
                        <strong className="refused">
                          {text['receiver.signatureInvalid']}
                        </strong>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </Screen>
  );
}
