import { notFound } from 'next/navigation';
import { InvoiceDocument } from '../../../../../../../../components/invoice-document';
import { getInvoice } from '../../../../../../../../lib/api';
import { isLang } from '../../../../../../../../lib/i18n';

// The document with nothing around it. The PDF is this page, printed.
export default async function InvoicePrint({
  params,
}: {
  params: Promise<{ lang: string; schoolId: string; invoiceId: string }>;
}) {
  const { lang, schoolId, invoiceId } = await params;
  if (!isLang(lang)) notFound();
  const result = await getInvoice(schoolId, invoiceId);
  if (!result.ok) notFound();
  return <InvoiceDocument invoice={result.data} lang={lang} />;
}
