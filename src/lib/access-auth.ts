export interface AccessEnvironment {
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
  ACCESS_ALLOWED_EMAIL?: string;
}

export interface AccessIdentity {
  subject: string;
  email: string;
}

interface AccessJwtPayload {
  iss?: unknown;
  aud?: unknown;
  sub?: unknown;
  email?: unknown;
  exp?: unknown;
  nbf?: unknown;
}

interface JwkDocument {
  keys?: Array<JsonWebKey & { kid?: string; alg?: string; use?: string }>;
}

const keyCache = new Map<string, { expiresAt: number; keys: Map<string, CryptoKey> }>();

function decodeBase64Url(value: string) {
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) throw new Error('ACCESS_E_TOKEN');
  const padding = '='.repeat((4 - value.length % 4) % 4);
  const binary = atob(value.replaceAll('-', '+').replaceAll('_', '/') + padding);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function parseJsonPart<T>(value: string): T {
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(decodeBase64Url(value))) as T; }
  catch { throw new Error('ACCESS_E_TOKEN'); }
}

function normalizeConfiguration(env: AccessEnvironment) {
  let teamDomain: URL;
  try { teamDomain = new URL(env.ACCESS_TEAM_DOMAIN ?? ''); }
  catch { throw new Error('ACCESS_E_CONFIG'); }
  if (teamDomain.protocol !== 'https:' || teamDomain.pathname !== '/'
    || teamDomain.search || teamDomain.hash || !teamDomain.hostname.endsWith('.cloudflareaccess.com')) {
    throw new Error('ACCESS_E_CONFIG');
  }
  const audience = env.ACCESS_AUD?.trim() ?? '';
  const allowedEmail = env.ACCESS_ALLOWED_EMAIL?.trim().toLocaleLowerCase('en-US') ?? '';
  if (!/^[A-Za-z0-9_-]{20,200}$/u.test(audience)
    || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(allowedEmail)) throw new Error('ACCESS_E_CONFIG');
  return { teamDomain: teamDomain.origin, audience, allowedEmail };
}

async function keysFor(teamDomain: string, fetcher: typeof fetch, nowMs: number, refresh = false) {
  const cached = keyCache.get(teamDomain);
  if (!refresh && cached && cached.expiresAt > nowMs) return cached.keys;
  const response = await fetcher(`${teamDomain}/cdn-cgi/access/certs`, {
    headers: { accept: 'application/json', 'accept-encoding': 'identity' },
  });
  if (!response.ok || !response.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
    try { await response.body?.cancel(); } catch {}
    throw new Error('ACCESS_E_KEYS');
  }
  const length = Number(response.headers.get('content-length') ?? '0');
  if (length > 256 * 1024) {
    try { await response.body?.cancel(); } catch {}
    throw new Error('ACCESS_E_KEYS');
  }
  let document: JwkDocument;
  try { document = await response.json() as JwkDocument; }
  catch { throw new Error('ACCESS_E_KEYS'); }
  if (!Array.isArray(document.keys) || document.keys.length < 1 || document.keys.length > 20) {
    throw new Error('ACCESS_E_KEYS');
  }
  const keys = new Map<string, CryptoKey>();
  for (const jwk of document.keys) {
    if (jwk.kty !== 'RSA' || jwk.alg !== 'RS256' || jwk.use !== 'sig'
      || typeof jwk.kid !== 'string' || !jwk.kid) continue;
    const key = await crypto.subtle.importKey(
      'jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify'],
    );
    keys.set(jwk.kid, key);
  }
  if (!keys.size) throw new Error('ACCESS_E_KEYS');
  keyCache.set(teamDomain, { expiresAt: nowMs + 5 * 60 * 1000, keys });
  return keys;
}

export async function verifyAccessIdentity(
  request: Request,
  env: AccessEnvironment,
  { fetcher = fetch, now = () => Date.now(), strictExpiry = false }: { fetcher?: typeof fetch; now?: () => number; strictExpiry?: boolean } = {},
): Promise<AccessIdentity> {
  const { teamDomain, audience, allowedEmail } = normalizeConfiguration(env);
  const token = request.headers.get('cf-access-jwt-assertion') ?? '';
  if (!token || token.length > 16 * 1024) throw new Error('ACCESS_E_TOKEN');
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('ACCESS_E_TOKEN');
  const header = parseJsonPart<Record<string, unknown>>(parts[0]);
  const payload = parseJsonPart<AccessJwtPayload>(parts[1]);
  if (header.alg !== 'RS256' || typeof header.kid !== 'string' || !header.kid) throw new Error('ACCESS_E_TOKEN');
  const nowMs = now();
  let keys = await keysFor(teamDomain, fetcher, nowMs);
  let key = keys.get(header.kid);
  if (!key) {
    keys = await keysFor(teamDomain, fetcher, nowMs, true);
    key = keys.get(header.kid);
  }
  if (!key) throw new Error('ACCESS_E_TOKEN');
  const valid = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5', key, decodeBase64Url(parts[2]), new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
  );
  const seconds = Math.floor(nowMs / 1000);
  const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  const email = typeof payload.email === 'string' ? payload.email.trim().toLocaleLowerCase('en-US') : '';
  if (!valid || payload.iss !== teamDomain || !audiences.includes(audience)
    || typeof payload.sub !== 'string' || !payload.sub
    || typeof payload.exp !== 'number' || (strictExpiry ? payload.exp <= seconds : payload.exp < seconds - 30)
    || (typeof payload.nbf === 'number' && payload.nbf > seconds + 30)
    || email !== allowedEmail) throw new Error('ACCESS_E_IDENTITY');
  return { subject: payload.sub, email };
}

export function clearAccessKeyCacheForTests() {
  keyCache.clear();
}
