// One shared password for the internal pages (/internal/...), outside the
// Shopify admin. Set REPORTS_PASSWORD as a Fly secret; without it the pages
// stay closed. The signed cookie holds a hash of the password, so changing
// the password signs everyone out.
import crypto from 'node:crypto';
import { createCookie } from 'react-router';

const SESSION_HOURS = 12;

const password = () => process.env.REPORTS_PASSWORD || '';
const digest = (s) => crypto.createHash('sha256').update(`brix-internal:${s}`).digest();

export const internalEnabled = () => password().length >= 12;

const cookie = createCookie('brix_internal', {
  path: '/internal',
  httpOnly: true,
  sameSite: 'strict',
  secure: process.env.NODE_ENV === 'production',
  maxAge: SESSION_HOURS * 3600,
  secrets: [process.env.SHOPIFY_API_SECRET || 'brix-internal-dev'],
});

export async function isSignedIn(request) {
  if (!internalEnabled()) return false;
  const value = await cookie.parse(request.headers.get('Cookie'));
  const got = Buffer.from(String(value?.p || ''), 'base64');
  const want = digest(password());
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}

/** Set-Cookie header value when `attempt` is right, else null (after a pause, to slow guessing). */
export async function signIn(attempt) {
  if (internalEnabled() && crypto.timingSafeEqual(digest(String(attempt || '')), digest(password()))) {
    return cookie.serialize({ p: digest(password()).toString('base64') });
  }
  await new Promise((r) => setTimeout(r, 1000));
  return null;
}

export const signOut = () => cookie.serialize('', { maxAge: 0 });

/** Headers for every internal page: never cached, indexed or framed. */
export const INTERNAL_HEADERS = {
  'Content-Type': 'text/html; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Robots-Tag': 'noindex, nofollow',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; img-src data:; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
};
