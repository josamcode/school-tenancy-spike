'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { acceptApplication } from '../../../../../../lib/api';
import { isLang } from '../../../../../../lib/i18n';
import { UUID } from '../../../../../../lib/outcome';
import { ACCEPTED_COOKIE } from '../../../../../../lib/accepted';

// Accepts an application through the API, as the signed-in user, and goes to
// the page that follows it. What the API answered is kept for that page.
export async function accept(form: FormData): Promise<void> {
  const lang = form.get('lang');
  const schoolId = form.get('schoolId');
  const applicationId = form.get('applicationId');
  if (
    !isLang(lang) ||
    typeof schoolId !== 'string' ||
    typeof applicationId !== 'string' ||
    !UUID.test(schoolId) ||
    !UUID.test(applicationId)
  ) {
    throw new Error('Not an application');
  }

  const { exchange } = await acceptApplication(schoolId, applicationId);
  (await cookies()).set(
    ACCEPTED_COOKIE,
    JSON.stringify({ applicationId, exchange }),
    { httpOnly: true, sameSite: 'lax', path: '/' },
  );
  redirect(`/${lang}/schools/${schoolId}/admissions/${applicationId}`);
}
