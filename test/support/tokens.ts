import { SignJWT } from 'jose';

const encode = (value: string) => new TextEncoder().encode(value);
const key = () => encode(process.env.JWT_SECRET ?? '');

export function tokenFor(userId: string): Promise<string> {
  return new SignJWT()
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId)
    .setExpirationTime('5m')
    .sign(key());
}

export function tokenWithoutExpiry(userId: string): Promise<string> {
  return new SignJWT()
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId)
    .sign(key());
}

export function expiredToken(userId: string): Promise<string> {
  return new SignJWT()
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId)
    .setExpirationTime(Math.floor(Date.now() / 1000) - 60)
    .sign(key());
}

export function tokenSignedWithAnotherKey(userId: string): Promise<string> {
  return new SignJWT()
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId)
    .setExpirationTime('5m')
    .sign(encode('another_key_that_the_server_does_not_know'));
}

export function tokenWithoutSubject(): Promise<string> {
  return new SignJWT()
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime('5m')
    .sign(key());
}

export function unsignedToken(userId: string): string {
  const part = (value: object) =>
    Buffer.from(JSON.stringify(value)).toString('base64url');
  const exp = Math.floor(Date.now() / 1000) + 300;
  return `${part({ alg: 'none', typ: 'JWT' })}.${part({ sub: userId, exp })}.`;
}
