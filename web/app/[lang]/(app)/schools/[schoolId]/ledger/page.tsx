import { notFound } from 'next/navigation';
import { ApiError } from '../../../../../../components/api-error';
import { Money } from '../../../../../../components/money';
import { Screen } from '../../../../../../components/screen';
import { getLedger, getMySchools } from '../../../../../../lib/api';
import { formatGregorian } from '../../../../../../lib/format';
import { isLang, messages } from '../../../../../../lib/i18n';
import { isZero } from '../../../../../../lib/outcome';

// The school's books, as the API gives them. There is nothing here to write
// with: no route of the API posts to the ledger.
export default async function LedgerScreen({
  params,
}: {
  params: Promise<{ lang: string; schoolId: string }>;
}) {
  const { lang, schoolId } = await params;
  if (!isLang(lang)) notFound();
  const text = messages(lang);

  const [schools, ledger] = await Promise.all([
    getMySchools(),
    getLedger(schoolId),
  ]);
  const exchanges = [schools.exchange, ledger.exchange];
  if (!ledger.ok) {
    return (
      <Screen lang={lang} exchanges={exchanges}>
        <h1>{text['ledger.title']}</h1>
        <ApiError status={ledger.status} problem={ledger.problem} lang={lang} />
      </Screen>
    );
  }
  const { currencyTotals, studentBalances, fxPositions, fxGainLoss, periods } =
    ledger.data;

  return (
    <Screen lang={lang} exchanges={exchanges}>
      <h1>{text['ledger.title']}</h1>
      <p data-testid="read-only">{text['ledger.readOnly']}</p>

      <h2>{text['ledger.totals']}</h2>
      <p className="lead">{text['ledger.totalsNote']}</p>
      {currencyTotals.length === 0 ? (
        <p>{text['ledger.noEntries']}</p>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>{text['ledger.currency']}</th>
                <th>{text['ledger.net']}</th>
                <th>{text['ledger.status']}</th>
              </tr>
            </thead>
            <tbody>
              {currencyTotals.map((row) => (
                <tr
                  key={row.currency}
                  data-testid="currency-total"
                  data-currency={row.currency}
                  data-balanced={isZero(row.total)}
                >
                  <td>
                    <bdi dir="ltr">{row.currency}</bdi>
                  </td>
                  <td>
                    <Money amount={row.total} currency={row.currency} />
                  </td>
                  <td>
                    {isZero(row.total) ? (
                      text['ledger.balanced']
                    ) : (
                      <strong className="refused">
                        {text['ledger.unbalanced']}
                      </strong>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h2>{text['ledger.students']}</h2>
      {studentBalances.length === 0 ? (
        <p>{text['ledger.noBalances']}</p>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>{text['ledger.student']}</th>
                <th>{text['ledger.balanceDue']}</th>
              </tr>
            </thead>
            <tbody>
              {studentBalances.map((row) => (
                <tr
                  key={`${row.studentId} ${row.currency}`}
                  data-testid="student-balance"
                  data-student={row.studentId}
                >
                  <td>
                    <bdi>{row.fullName ?? row.studentId}</bdi>
                  </td>
                  <td>
                    <Money amount={row.balance} currency={row.currency} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h2>{text['ledger.positions']}</h2>
      {fxPositions.length === 0 ? (
        <p>{text['ledger.noPositions']}</p>
      ) : (
        <>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>{text['ledger.currency']}</th>
                  <th>{text['ledger.held']}</th>
                  <th>{text['ledger.bookValue']}</th>
                  <th>{text['ledger.status']}</th>
                </tr>
              </thead>
              <tbody>
                {fxPositions.map((row) => (
                  <tr
                    key={row.currency}
                    data-testid="fx-position"
                    data-currency={row.currency}
                    data-state={isZero(row.held) ? 'closed' : 'open'}
                  >
                    <td>
                      <bdi dir="ltr">{row.currency}</bdi>
                    </td>
                    <td data-testid="fx-held">
                      <Money amount={row.held} currency={row.currency} />
                    </td>
                    <td data-testid="fx-book-value">
                      <Money
                        amount={row.bookValue}
                        currency={row.baseCurrency}
                      />
                    </td>
                    <td>
                      {isZero(row.held)
                        ? text['ledger.positionClosed']
                        : text['ledger.positionOpen']}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {fxGainLoss.map((row, index) => {
            // A negative gain is a loss. It is shown as one, without its sign.
            const loss = row.gain.startsWith('-');
            return (
              <p
                key={index}
                data-testid="fx-gain-loss"
                data-kind={loss ? 'loss' : 'gain'}
              >
                {text[loss ? 'ledger.fxLoss' : 'ledger.fxGain']}{' '}
                <Money
                  amount={loss ? row.gain.slice(1) : row.gain}
                  currency={row.currency}
                />
              </p>
            );
          })}
        </>
      )}

      <h2>{text['ledger.periods']}</h2>
      {periods.length === 0 ? (
        <p>{text['ledger.noPeriods']}</p>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>{text['ledger.year']}</th>
                <th>{text['ledger.from']}</th>
                <th>{text['ledger.to']}</th>
                <th>{text['ledger.status']}</th>
              </tr>
            </thead>
            <tbody>
              {periods.map((period) => (
                <tr
                  key={period.startDate}
                  data-testid="period"
                  data-start={period.startDate}
                  data-status={period.status}
                >
                  <td>
                    <bdi dir="ltr">{period.year}</bdi>
                  </td>
                  <td>{formatGregorian(period.startDate, lang)}</td>
                  <td>{formatGregorian(period.endDate, lang)}</td>
                  <td>
                    {period.status === 'locked'
                      ? text['ledger.locked']
                      : text['ledger.open']}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Screen>
  );
}
