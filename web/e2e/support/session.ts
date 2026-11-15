import type { BrowserContext } from '@playwright/test';
import { SignJWT } from 'jose';
import { JWT_SECRET, SESSION_COOKIE, WEB_URL } from './stack';

export type Lang = 'ar' | 'en';

export function tokenFor(userId: string): Promise<string> {
  return new SignJWT()
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId)
    .setExpirationTime('10m')
    .sign(new TextEncoder().encode(JWT_SECRET));
}

// The production build has no sign-in, so a test puts the session cookie
// there itself, holding the same kind of token the API tests use.
export async function signIn(
  context: BrowserContext,
  user: { id: string },
  url = WEB_URL,
): Promise<void> {
  await context.addCookies([
    {
      name: SESSION_COOKIE,
      value: await tokenFor(user.id),
      url,
      httpOnly: true,
      sameSite: 'Lax',
    },
  ]);
}

export const invoicesPath = (lang: Lang, school: { id: string }) =>
  `/${lang}/schools/${school.id}/invoices`;

export const invoicePath = (
  lang: Lang,
  invoice: { id: string; tenantId: string },
) => `/${lang}/schools/${invoice.tenantId}/invoices/${invoice.id}`;

export const pdfPath = (
  lang: Lang,
  invoice: { id: string; tenantId: string },
) => `${invoicePath(lang, invoice)}/pdf`;

export const ARABIC_INDIC_DIGITS = /[\u0660-\u0669\u06F0-\u06F9]/;
