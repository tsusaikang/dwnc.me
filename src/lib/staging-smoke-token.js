export const STAGING_SMOKE_TOKEN_BYTES = 32;
export const STAGING_SMOKE_TOKEN_CHARACTERS = 43;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/u;

function canonicalBase64Url(value) {
  try {
    const binary = atob(`${value.replaceAll('-', '+').replaceAll('_', '/')}=`);
    if (binary.length !== STAGING_SMOKE_TOKEN_BYTES) return null;
    return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
  } catch {
    return null;
  }
}

export function isCanonicalStagingSmokeToken(value) {
  return typeof value === 'string' && TOKEN_PATTERN.test(value)
    && canonicalBase64Url(value) === value;
}

export function validateStagingSmokeToken(value) {
  if (!isCanonicalStagingSmokeToken(value)) {
    throw new Error('CLOUDFLARE_E_SMOKE_TOKEN_BYTES');
  }
  return value;
}

export function stagingSmokeAuthorizationHeader(value) {
  return `Bearer ${validateStagingSmokeToken(value)}`;
}
