import { notFound } from 'next/navigation';
import { ApiError } from '../../../../../../components/api-error';
import { getInvoices } from '../../../../../../lib/api';
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

  const result = await getInvoices(schoolId);
  if (!result.ok) {
    return (
      <ApiError status={result.status} problem={result.problem} lang={lang} />
    );
  }
  const invoices = [...result.data].sort((a, b) => a.number - b.number);

  return (
    <>
      <h1>{text['invoices.title']}</h1>
      {invoices.length === 0 ? (
        <p>{text['invoices.empty']}</p>
      ) : (
        <table className="list">
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
    </>
  );
}
