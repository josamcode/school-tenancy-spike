'use server';

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parseEnv } from 'node:util';
import { SignJWT } from 'jose';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { seedUsers } from '../../../../dev/seed-users';
import { SESSION_COOKIE } from '../../../../lib/api';
import { isLang } from '../../../../lib/i18n';

// The API's development secret: from the environment, or from the .env file
// at the root of the repository, which is where the API reads it.
function developmentSecret(): string {
  const secret =
    process.env.JWT_SECRET ??
    parseEnv(readFileSync(path.join(process.cwd(), '..', '.env'), 'utf8'))
      .JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET is not set');
  return secret;
}

// Stands in for an identity provider, in development only: it signs the same
// token the API's own tests use, for a user on the seed list and no one else.
export async function signInAsSeedUser(form: FormData): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('The demo sign-in does not exist in production');
  }
  const lang = form.get('lang');
  const user = seedUsers.find(
    (candidate) =>
      candidate.userId === form.get('userId') &&
      candidate.schoolId === form.get('schoolId'),
  );
  if (!user || !isLang(lang)) throw new Error('Not on the seed list');

  const token = await new SignJWT()
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(user.userId)
    .setExpirationTime('8h')
    .sign(new TextEncoder().encode(developmentSecret()));
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
  });
  redirect(`/${lang}/schools/${user.schoolId}/invoices`);
}
