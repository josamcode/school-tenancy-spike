import { redirect } from 'next/navigation';
import { isLang } from '../../../../lib/i18n';

// Opens a school by its id. Whatever is typed goes to the API as it is, and
// the API's answer is what the students page shows.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ lang: string }> },
) {
  const { lang } = await params;
  if (!isLang(lang)) return new Response(null, { status: 404 });
  const school = new URL(request.url).searchParams.get('school')?.trim() ?? '';
  redirect(`/${lang}/schools/${encodeURIComponent(school)}/students`);
}
