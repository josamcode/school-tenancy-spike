import { getInvoice, sessionToken } from '../../../../../../../../lib/api';
import { formatInvoiceNumber } from '../../../../../../../../lib/format';
import { isLang } from '../../../../../../../../lib/i18n';
import { renderPdf } from '../../../../../../../../lib/pdf';

export async function GET(
  _request: Request,
  {
    params,
  }: {
    params: Promise<{ lang: string; schoolId: string; invoiceId: string }>;
  },
) {
  const { lang, schoolId, invoiceId } = await params;
  if (!isLang(lang)) {
    return Response.json(
      { statusCode: 404, message: 'Not Found' },
      { status: 404 },
    );
  }

  // The API is asked first, as the caller. Whatever it refuses is the answer
  // here too, and no browser is started for it.
  const invoice = await getInvoice(schoolId, invoiceId);
  if (!invoice.ok) {
    return Response.json(invoice.problem, { status: invoice.status });
  }

  // Both ids are known to be UUIDs now: the API accepted them.
  const pdf = await renderPdf(
    `/${lang}/schools/${schoolId}/invoices/${invoiceId}/print`,
    await sessionToken(),
  );
  const name = formatInvoiceNumber(invoice.data.number);
  return new Response(new Uint8Array(pdf), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${name}.pdf"`,
      'Cache-Control': 'private, no-store',
    },
  });
}
