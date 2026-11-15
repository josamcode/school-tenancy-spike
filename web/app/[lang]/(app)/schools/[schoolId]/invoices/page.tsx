import { notFound } from 'next/navigation';
import { ApiError } from '../../../../../../components/api-error';
import { Screen } from '../../../../../../components/screen';
import { getInvoices, getMySchools } from '../../../../../../lib/api';
import {
  formatGregorian,
  formatInvoiceNumber,
} from '../../../../../../lib/format';
import { isLang, messages } from '../../../../../../lib/i18n';

export default async function Invoices({
  params,
}: {
  params: Promise<{ lang: string; schoolId: string }>;
}) {
  const { lang, schoolId } = await params;
  if (!isLang(lang)) notFound();
  const text = messages(lang);

  const [schools, result] = await Promise.all([
    getMySchools(),
    getInvoices(schoolId),
  ]);
  const exchanges = [result.exchange, schools.exchange];
  if (!result.ok) {
    return (
      <Screen lang={lang} exchanges={exchanges}>
        <h1>{text['invoices.title']}</h1>
        <ApiError status={result.status} problem={result.problem} lang={lang} />
      </Screen>
    );
  }
  const invoices = [...result.data].sort((a, b) => a.number - b.number);

  return (
    <Screen lang={lang} exchanges={exchanges}>
      <h1>{text['invoices.title']}</h1>
      {invoices.length === 0 ? (
        <p>{text['invoices.empty']}</p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>{text['invoices.number']}</th>
              <th>{text['invoices.issueDate']}</th>
            </tr>
          </thead>
          <tbody>
            {invoices.map((invoice) => (
              <tr key={invoice.id}>
                <td>
                  <a
                    href={`/${lang}/schools/${schoolId}/invoices/${invoice.id}`}
                    data-testid="invoice-link"
                  >
                    <bdi dir="ltr">{formatInvoiceNumber(invoice.number)}</bdi>
                  </a>
                </td>
                <td>{formatGregorian(invoice.issueDate, lang)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Screen>
  );
}
