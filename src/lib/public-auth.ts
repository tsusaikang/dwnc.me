import { verifyAccessIdentity, type AccessEnvironment } from './access-auth.ts';

const AUTH_PREFIX = '/auth';
const LOGIN_PATH = '/auth/login';
const SESSION_PATH = '/auth/session';

/** Keep the login return on this site and outside authentication endpoints. */
export function safePublicLoginReturn(value: string | null, origin: string): string {
  if (!value || value.length > 2048) return '/';
  let decoded = value;
  try {
    for (let pass = 0; pass < 5; pass++) {
      if (!decoded.startsWith('/') || decoded.startsWith('//') || /[\\\u0000-\u001f\u007f]/u.test(decoded)) return '/';
      const url = new URL(decoded, origin);
      if (url.origin !== origin || url.pathname.startsWith('//')
        || /^\/(?:auth|cdn-cgi)(?:\/|$)/iu.test(url.pathname)) return '/';
      if (!decoded.includes('%')) {
        const target = new URL(value, origin);
        return target.pathname + target.search + target.hash;
      }
      const next = decodeURIComponent(decoded);
      if (next === decoded) return '/';
      decoded = next;
    }
  } catch { /* Malformed or excessively encoded return paths fall back to home. */ }
  return '/';
}

function reply(request: Request, authenticated: boolean, status: number, extraHeaders?: HeadersInit) {
  const headers = new Headers({
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'vary': 'Origin, Cookie',
    'referrer-policy': 'same-origin',
  });
  new Headers(extraHeaders).forEach((value, name) => headers.set(name, value));
  return new Response(request.method === 'HEAD' ? null : JSON.stringify({ authenticated }), { status, headers });
}

/** Access protects /auth/* at the edge; public content never enters this handler. */
export async function handlePublicAuth(request: Request, env: AccessEnvironment): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname !== AUTH_PREFIX && !url.pathname.startsWith(`${AUTH_PREFIX}/`)) return null;
  if (url.pathname !== LOGIN_PATH && url.pathname !== SESSION_PATH) return reply(request, false, 404);
  if (!['GET', 'HEAD'].includes(request.method)) return reply(request, false, 405, { allow: 'GET, HEAD' });
  const origin = request.headers.get('origin');
  if (url.hash || origin !== null && origin !== url.origin) return reply(request, false, 403);
  if (url.pathname === SESSION_PATH && url.search) return reply(request, false, 403);
  if (url.pathname === LOGIN_PATH && (url.searchParams.getAll('return').length > 1
    || [...url.searchParams.keys()].some((name) => name !== 'return'))) return reply(request, false, 400);
  try { await verifyAccessIdentity(request, env, { strictExpiry: true }); }
  catch { return reply(request, false, 401); }
  if (url.pathname === SESSION_PATH) return reply(request, true, 200);
  return reply(request, true, 303, { location: safePublicLoginReturn(url.searchParams.get('return'), url.origin) });
}
