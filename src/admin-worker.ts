import { verifyAccessIdentity, type AccessEnvironment } from './lib/access-auth.ts';
import { adminHtml } from './lib/admin-ui.ts';
import edgeRedirectManifest from '../docs/EDGE_REDIRECTS_V1.json' with { type: 'json' };
import mediaManifest from './data/public-media-r2-v1.json' with { type: 'json' };
import publicRequestSurface from './data/public-request-surface-v1.json' with { type: 'json' };
import {
  NATIVE_MEDIA_PATH_PATTERN, NATIVE_POST_ID_PATTERN, normalizeLegacyPostInput, normalizeNativePostInput,
} from './lib/native-content.ts';
import { createMediaWorker } from './lib/media-worker.ts';
import { serveAdminNativeMedia } from './lib/native-public-worker.ts';
import { NativePostStore } from './lib/native-post-store.ts';
import { TAXONOMY } from './lib/taxonomy.ts';

interface AdminEnvironment extends AccessEnvironment {
  MEDIA_BUCKET: R2Bucket;
  NATIVE_DB: D1Database;
  NATIVE_MEDIA_BUCKET: R2Bucket;
}

const serveLegacyMedia = createMediaWorker(
  mediaManifest.entries,
  mediaManifest.manifestSha256,
  publicRequestSurface,
  edgeRedirectManifest,
);

const MIME_EXTENSIONS = new Map([
  ['image/avif', 'avif'], ['image/gif', 'gif'], ['image/jpeg', 'jpg'],
  ['image/png', 'png'], ['image/webp', 'webp'],
]);
const MAX_JSON_BYTES = 1_100_000;
const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
const LEGACY_POST_ID_PATTERN = /^legacy-([1-9]\d{0,2})$/u;

function validAdminPostId(value: string) {
  const legacy = value.match(LEGACY_POST_ID_PATTERN);
  return NATIVE_POST_ID_PATTERN.test(value) || Boolean(legacy && Number(legacy[1]) <= 596);
}

function json(value: unknown, status = 200) {
  return Response.json(value, { status, headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } });
}

async function requestJson(request: Request) {
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) throw new Error('ADMIN_E_JSON');
  const declared = Number(request.headers.get('content-length') ?? '0');
  if (declared > MAX_JSON_BYTES) throw new Error('ADMIN_E_JSON');
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_JSON_BYTES) throw new Error('ADMIN_E_JSON');
  try { return JSON.parse(text || '{}') as Record<string, unknown>; }
  catch { throw new Error('ADMIN_E_JSON'); }
}

function sameOrigin(request: Request) {
  if (['GET', 'HEAD'].includes(request.method)) return true;
  const origin = request.headers.get('origin');
  return origin === new URL(request.url).origin;
}

async function route(request: Request, env: AdminEnvironment, identityEmail: string, context: ExecutionContext) {
  const url = new URL(request.url);
  if (url.search || url.hash || !sameOrigin(request)) return json({ error: '요청을 처리할 수 없습니다.' }, 403);
  const store = new NativePostStore(env.NATIVE_DB);
  if (request.method === 'GET' && url.pathname === '/') {
    return new Response(adminHtml(identityEmail), { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'; form-action 'self'" } });
  }
  if (NATIVE_MEDIA_PATH_PATTERN.test(url.pathname)) return serveAdminNativeMedia(request, env);
  if (url.pathname.startsWith('/media/')) return serveLegacyMedia(request, env, context);
  if (request.method === 'GET' && url.pathname === '/api/posts') return json({ posts: await store.listForAdmin() });
  if (request.method === 'POST' && url.pathname === '/api/posts') {
    await requestJson(request);
    const category = TAXONOMY[0];
    return json({ post: await store.createDraft(category) }, 201);
  }
  const match = url.pathname.match(/^\/api\/posts\/([^/]+)(?:\/(preview|publish|media))?$/u);
  if (!match || !validAdminPostId(match[1])) return json({ error: '찾을 수 없습니다.' }, 404);
  const [, id, action] = match;
  if (request.method === 'GET' && !action) {
    const post = await store.getForAdmin(id);
    return post ? json({ post }) : json({ error: '찾을 수 없습니다.' }, 404);
  }
  if (request.method === 'PUT' && !action) {
    const body = await requestJson(request);
    return json({ post: await store.update(id, Number(body.expectedRevision), body.input) });
  }
  if (request.method === 'POST' && action === 'preview') {
    const body = await requestJson(request);
    const post = await store.getForAdmin(id);
    if (!post) return json({ error: '찾을 수 없습니다.' }, 404);
    const html = post.bodyFormat === 'html'
      ? normalizeLegacyPostInput(body.input, { requirePublishable: false }).bodyHtml
      : normalizeNativePostInput(body.input, { requirePublishable: false }).bodyHtml;
    return json({ html });
  }
  if (request.method === 'POST' && action === 'publish') {
    const body = await requestJson(request);
    return json({ post: await store.publish(id, Number(body.expectedRevision)) });
  }
  if (request.method === 'POST' && action === 'media') {
    const mime = request.headers.get('content-type')?.split(';', 1)[0].toLowerCase() ?? '';
    const extension = MIME_EXTENSIONS.get(mime);
    const bytes = Number(request.headers.get('x-dwnc-file-size') ?? '');
    const sha256 = request.headers.get('x-dwnc-file-sha256')?.toLowerCase() ?? '';
    if (!extension || !Number.isSafeInteger(bytes) || bytes < 1 || bytes > MAX_IMAGE_BYTES
      || !/^[a-f0-9]{64}$/u.test(sha256) || !request.body) throw new Error('ADMIN_E_MEDIA');
    const post = await store.getForAdmin(id);
    if (!post || post.status === 'tombstone') throw new Error('NATIVE_E_MEDIA_POST');
    const body = await request.arrayBuffer();
    if (body.byteLength !== bytes) throw new Error('ADMIN_E_MEDIA');
    const mediaId = crypto.randomUUID();
    const objectKey = `media/native/${mediaId}.${extension}`;
    const publicPath = `/${objectKey}`;
    const object = await env.NATIVE_MEDIA_BUCKET.put(objectKey, body, {
      onlyIf: { etagDoesNotMatch: '*' }, sha256,
      httpMetadata: { contentType: mime, cacheControl: 'public, max-age=31536000, immutable' },
      customMetadata: { sha256, contract: 'dwnc-native-media-v1' },
    });
    if (!object || object.size !== bytes || object.customMetadata?.sha256 !== sha256) throw new Error('ADMIN_E_MEDIA_STORE');
    const encodedName = request.headers.get('x-dwnc-file-name') ?? '';
    let alt = '이미지';
    try { alt = decodeURIComponent(encodedName).replace(/[\u0000-\u001f\u007f]/gu, '').trim().slice(0, 200) || alt; } catch {}
    const media = await store.addMedia({ id: mediaId, postId: id, publicPath, objectKey, sha256, bytes, mime, alt, createdAt: new Date().toISOString() });
    return json({ media }, 201);
  }
  return json({ error: '허용되지 않은 요청입니다.' }, 405);
}

function errorResponse(error: unknown) {
  const code = error instanceof Error ? error.message : '';
  if (code === 'NATIVE_E_REVISION') return json({ error: '다른 변경이 먼저 저장되었습니다. 현재 작성 내용은 유지됩니다.', code: 'revision_conflict' }, 409);
  if (code.startsWith('NATIVE_E_') || code.startsWith('ADMIN_E_')) return json({ error: '입력 내용을 확인해 주세요.' }, 400);
  console.error(JSON.stringify({ event: 'dwnc_admin_error', code: 'ADMIN_E_INTERNAL' }));
  return json({ error: '잠시 후 다시 시도해 주세요.' }, 500);
}

export default {
  async fetch(request: Request, env: AdminEnvironment, context: ExecutionContext): Promise<Response> {
    let identity;
    try { identity = await verifyAccessIdentity(request, env); }
    catch { return json({ error: '로그인이 필요합니다.', code: 'authentication_required' }, 401); }
    try { return await route(request, env, identity.email, context); }
    catch (error) { return errorResponse(error); }
  },
} satisfies ExportedHandler<AdminEnvironment>;
