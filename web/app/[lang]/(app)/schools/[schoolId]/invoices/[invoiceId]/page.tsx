import { notFound } from 'next/navigation';
import { ApiError } from '../../../../../../../components/api-error';
import { InvoiceDocument } from '../../../../../../../components/invoice-document';
import { getInvoice } from '../../../../../../../lib/api';
import { isLang, messages } from '../../../../../../../lib/i18n';

export default async function InvoiceScreen({
  params,
}: {
  params: Promise<{ lang: string; schoolId: string; invoiceId: string }>;
}) {
  const { lang, schoolId, invoiceId } = await params;
  if (!isLang(lang)) notFound();
  const text = messages(lang);

  const result = await getInvoice(schoolId, invoiceId);
  if (!result.ok) {
    return (
      <ApiError status={result.status} problem={result.problem} lang={lang} />
    );
  }
  const invoices = `/${lang}/schools/${schoolId}/invoices`;

  return (
    <>
      <nav className="actions">
        <a href={invoices}>{text['invoice.back']}</a>
        <a href={`${invoices}/${invoiceId}/pdf`} data-testid="pdf-link">
          {text['invoice.pdf']}
        </a>
      </nav>
      <InvoiceDocument invoice={result.data} lang={lang} />
    </>
  );
}
