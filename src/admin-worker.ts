import { categoryDisplayId } from './lib/category-display.ts';
import { prepareHtmlSourcePaste } from './lib/html-source-paste.ts';
import { PostViewStatistics } from './lib/post-view-statistics.ts';
import { boundedBody } from './lib/content-operations.ts';
import { SITE_MEDIA_PATH_PATTERN } from './lib/cms-configuration.ts';
import { serveSiteMedia } from './lib/native-public-worker.ts';
import { prepareImportedPresentation, IMPORTED_PRESENTATION_CSS, ENGINE_DIAGRAM_CSS } from './lib/imported-presentation.ts';
import { verifyAccessIdentity, type AccessEnvironment } from './lib/access-auth.ts';
import { adminHtml } from './lib/admin-ui.ts';
import edgeRedirectManifest from '../docs/EDGE_REDIRECTS_V1.json' with { type: 'json' };
import mediaManifest from './data/public-media-r2-v1.json' with { type: 'json' };
import publicRequestSurface from './data/public-request-surface-v1.json' with { type: 'json' };
import imageCodecAssets from './data/image-codec-assets.json' with { type: 'json' };
import {
  IMPORTED_MEDIA_PATH_PATTERN, NATIVE_MEDIA_PATH_PATTERN, NATIVE_POST_ID_PATTERN,
} from './lib/native-content.ts';
import { createMediaWorker } from './lib/media-worker.ts';
import { serveAdminNativeMedia } from './lib/native-public-worker.ts';
import { NativePostStore } from './lib/native-post-store.ts';
import { CmsConfigurationStore } from './lib/cms-configuration.ts';

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
const FONT_PATHS = new Set(['NanumGothic.woff', 'NanumGothicBold.ttf', 'NanumMyeongjo.woff', 'NanumMyeongjoBold.woff', 'NanumBarunGothic.woff', 'NanumBarunGothicBold.woff'].map((name) => `/fonts/nanum/${name}`));
const IMAGE_CODEC_PATHS = new Map(Object.entries(imageCodecAssets).map(([name, mime]) => [`/image-codecs/${name}`, mime]));
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

function notFound(request: Request) {
  const pathname = new URL(request.url).pathname;
  const browserPage = ['GET', 'HEAD'].includes(request.method)
    && request.headers.get('accept')?.toLowerCase().includes('text/html')
    && pathname !== '/api' && !pathname.startsWith('/api/');
  if (!browserPage) return json({ error: '찾을 수 없습니다.' }, 404);
  return new Response(request.method === 'HEAD' ? null : `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>페이지를 찾을 수 없습니다 — 블로그 관리</title>
<style>*{box-sizing:border-box}body{margin:0;background:#f6f7f8;color:#25292e;font:16px/1.7 system-ui,sans-serif}main{max-width:640px;margin:12vh auto;padding:32px 24px}h1{font-size:clamp(24px,5vw,32px);line-height:1.4}p{color:#58616b}nav{display:flex;flex-wrap:wrap;gap:12px;margin-top:28px}a{padding:10px 18px;border:1px solid #cdd3d9;border-radius:8px;background:#fff;color:#244b76;text-decoration:none}a:first-child{background:#244b76;border-color:#244b76;color:#fff}a:hover{text-decoration:underline}a:focus-visible{outline:3px solid #e19a23;outline-offset:3px}</style>
</head><body><main><h1>페이지를 찾을 수 없습니다</h1><p>이 주소는 블로그 관리 화면입니다.<br>글을 관리하려면 관리자 홈으로, 공개된 글을 보려면 공개 글 목록으로 이동해 주세요.</p><nav aria-label="이동할 곳"><a href="/">관리자 홈으로</a><a href="https://dwnc.me/archive">공개 글 목록 보기</a></nav></main></body></html>`, {
    status: 404,
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'vary': 'Accept', 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'" },
  });
}

async function requestJson(request: Request) {
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) throw new Error('ADMIN_E_JSON');
  const declared = Number(request.headers.get('content-length') ?? '0');
  if (declared > MAX_JSON_BYTES) throw new Error('ADMIN_E_JSON');
  const text = new TextDecoder().decode(await boundedBody(request,MAX_JSON_BYTES));
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
  if (url.hash || (url.search && !(request.method === 'GET' && ['/api/posts','/api/statistics','/api/posts/resolve'].includes(url.pathname))) || !sameOrigin(request)) return json({ error: '요청을 처리할 수 없습니다.' }, 403);
  const store = new NativePostStore(env.NATIVE_DB);
  if (request.method === 'GET' && url.pathname === '/') {
    return new Response(adminHtml(identityEmail), { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'self'; style-src 'unsafe-inline'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'; worker-src 'self'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'; form-action 'self'" } });
  }
  const codecMime = IMAGE_CODEC_PATHS.get(url.pathname);
  if (codecMime) {
    if (!['GET', 'HEAD'].includes(request.method)) return new Response(null, { status: 405, headers: { allow: 'GET, HEAD', 'cache-control': 'no-store' } });
    // Only reviewed public code and licence assets cross this fixed origin.
    // Do not forward cookies, Access assertions, request headers, or redirects.
    let response: Response;
    try { response = await fetch(`https://dwnc.me${url.pathname}`, { method: request.method, redirect: 'error', signal: AbortSignal.timeout(15000) }); }
    catch { return json({ error: '사진 처리 도구를 불러오지 못했습니다.' }, 502); }
    const upstreamMime = response.headers.get('content-type')?.split(';', 1)[0].toLowerCase();
    const compatibleMime = upstreamMime === codecMime || codecMime === 'text/javascript' && upstreamMime === 'application/javascript';
    if (response.status !== 200 || !compatibleMime) {
      try { await response.body?.cancel(); } catch {}
      return json({ error: '사진 처리 도구를 불러오지 못했습니다.' }, 502);
    }
    const headers = new Headers({
      'content-type': codecMime,
      'cache-control': 'private, max-age=0, must-revalidate',
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self'; worker-src 'self'",
    });
    return new Response(request.method === 'HEAD' ? null : response.body, { headers });
  }
  if (FONT_PATHS.has(url.pathname) && ['GET','HEAD'].includes(request.method)) {
    // Fonts are published application assets. Never forward the author's Access
    // assertion, cookies, origin, or any request-controlled URL/header.
    const response = await fetch(`https://dwnc.me${url.pathname}`,{method:request.method,redirect:'error',signal:AbortSignal.timeout(10000)});
    if (!response.ok) { try { await response.body?.cancel(); } catch {} return json({error:'글꼴을 불러오지 못했습니다.'},502); }
    const headers = new Headers({'content-type':url.pathname.endsWith('.ttf')?'font/ttf':'font/woff','cache-control':'private, max-age=3600','x-content-type-options':'nosniff'});
    return new Response(request.method==='HEAD'?null:response.body,{headers});
  }
  if (SITE_MEDIA_PATH_PATTERN.test(url.pathname)) return serveSiteMedia(request,env,true);
  if (NATIVE_MEDIA_PATH_PATTERN.test(url.pathname) || IMPORTED_MEDIA_PATH_PATTERN.test(url.pathname)) return serveAdminNativeMedia(request, env);
  if (url.pathname.startsWith('/media/')) return serveLegacyMedia(request, env, context);
  if (request.method === 'POST' && url.pathname === '/api/html-paste') return json(prepareHtmlSourcePaste((await requestJson(request)).html));
  const config = new CmsConfigurationStore(env.NATIVE_DB);
  if (request.method === 'GET' && url.pathname === '/api/posts/resolve') {
    const paths = url.searchParams.getAll('path');
    if (paths.length !== 1 || [...url.searchParams.keys()].some(key => key !== 'path')
      || !(/^\/posts\/[1-9]\d*$/u.test(paths[0]) || paths[0].startsWith('/pages/') && NATIVE_POST_ID_PATTERN.test(paths[0].slice(7)))) throw new Error('ADMIN_E_QUERY');
    const entry = (await store.listForAdmin()).find(post => post.publicPath === paths[0]);
    const post = entry ? await store.getForAdmin(entry.id) : null;
    return post ? json({ post }) : json({ error: '찾을 수 없습니다.', code: 'post_not_found' }, 404);
  }
  if (request.method === 'GET' && url.pathname === '/api/statistics') return json(await new PostViewStatistics(env.NATIVE_DB).summary(url.searchParams));
  if (url.pathname === '/api/categories') {
    if (request.method === 'GET') {
      const result = await config.categories(); const posts = await store.listForAdmin();
      return json({ revision: result.revision, categories: result.value.map((node) => ({ ...node, postCount: posts.filter((post) => post.categoryId === node.id).length })) });
    }
    if (request.method === 'PUT') { const body = await requestJson(request); const result = await config.saveCategories(Number(body.expectedRevision), body.categories); return json({ categories: result.value, revision: result.revision }); }
  }
  if (url.pathname === '/api/settings') {
    if (request.method === 'GET') { const result = await config.settings(); return json({ settings: result.value, revision: result.revision }); }
    if (request.method === 'PUT') { const body = await requestJson(request); const result = await config.saveSettings(Number(body.expectedRevision), body.settings); return json({ settings: result.value, revision: result.revision }); }
  }
  if (url.pathname === '/api/templates') {
    if(request.method==='GET'){const result=await config.templates();return json({templates:result.value,revision:result.revision});}
    if(request.method==='PUT'){const body=await requestJson(request),result=await config.saveTemplates(Number(body.expectedRevision),body.templates);return json({templates:result.value,revision:result.revision});}
  }
  if (url.pathname === '/api/icon' && request.method === 'POST') {
    const mime=request.headers.get('content-type')?.split(';',1)[0].toLowerCase()??'', extension=MIME_EXTENSIONS.get(mime), bytes=Number(request.headers.get('x-dwnc-file-size')??''), sha256=request.headers.get('x-dwnc-file-sha256')?.toLowerCase()??'';
    if(!extension||!Number.isSafeInteger(bytes)||bytes<1||bytes>1024*1024||!/^[a-f0-9]{64}$/u.test(sha256)||!request.body)throw new Error('ADMIN_E_MEDIA');
    const body=await boundedBody(request,1024*1024);if(body.byteLength!==bytes)throw new Error('ADMIN_E_MEDIA');
    const id=crypto.randomUUID(),objectKey=`media/site/${id}.${extension}`,path=`/${objectKey}`;
    const object=await env.NATIVE_MEDIA_BUCKET.put(objectKey,body,{onlyIf:{etagDoesNotMatch:'*'},sha256,httpMetadata:{contentType:mime},customMetadata:{sha256,contract:'dwnc-site-media-v1'}});
    if(!object||object.size!==bytes||object.customMetadata?.sha256!==sha256)throw new Error('ADMIN_E_MEDIA_STORE');
    await env.NATIVE_DB.prepare('INSERT INTO cms_media(id,public_path,object_key,sha256,bytes,mime,created_at) VALUES(?1,?2,?3,?4,?5,?6,?7)').bind(id,path,objectKey,sha256,bytes,mime,new Date().toISOString()).run();
    return json({path},201);
  }
  if (request.method === 'GET' && url.pathname === '/api/tags') {
    const counts = new Map<string, number>(); for (const post of await store.listForAdmin()) for (const label of post.tags) counts.set(label, (counts.get(label) ?? 0) + 1);
    return json({ tags: [...counts].map(([label,count]) => ({label,count})).sort((a,b) => a.label.localeCompare(b.label,'ko')) });
  }
  if (request.method === 'GET' && url.pathname === '/api/posts') {
    const sort = url.searchParams.get('sort') ?? 'updated-desc';
    if (sort !== 'created-desc' && sort !== 'created-asc' && sort !== 'updated-desc' && sort !== 'updated-asc') throw new Error('ADMIN_E_QUERY');
    let posts = await store.listForAdmin(sort);
    if (!url.search) return json({posts});
    if ([...url.searchParams.keys()].some((key) => !['q','categoryId','status','kind','page','pageSize','sort'].includes(key))) throw new Error('ADMIN_E_QUERY');
    const q = (url.searchParams.get('q') ?? '').normalize('NFC').trim().toLocaleLowerCase('ko');
    const categoryId = url.searchParams.get('categoryId'); const status = url.searchParams.get('status') ?? 'all';
    const page = Number(url.searchParams.get('page') ?? 1), pageSize = Number(url.searchParams.get('pageSize') ?? 20);
    if (q.length > 180 || !['all','draft','published','changed','private','scheduled','protected'].includes(status) || !Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 100) throw new Error('ADMIN_E_QUERY');
    const kind = url.searchParams.get('kind') ?? 'all';
    if(!['all','post','page','notice'].includes(kind)) throw new Error('ADMIN_E_QUERY');
    const visibleNow = (post: {visibility?: string;scheduledAt?: string|null}) => !post.visibility || post.visibility==='public' || post.visibility==='scheduled' && !!post.scheduledAt && post.scheduledAt<=new Date().toISOString();
    const bodyMatches = q ? await store.searchAdminBodyIds(q) : new Set<string>();
    posts = posts.filter((post) => (kind === 'all' || post.kind === kind) && (!q || bodyMatches.has(post.id) || [post.title,...post.tags,String(post.globalSequence ?? '')].join(' ').toLocaleLowerCase('ko').includes(q)) && (!categoryId || categoryDisplayId(post.categoryId) === categoryDisplayId(categoryId)) && (status === 'all' || (status === 'changed' ? post.status === 'published' && post.hasUnpublishedChanges : ['private','scheduled','protected'].includes(status) ? post.visibility === status && post.status === 'published' && (status!=='scheduled'||!visibleNow(post)) : post.status === status && (status!=='published'||visibleNow(post)))));
    return json({posts:posts.slice((page-1)*pageSize,page*pageSize),total:posts.length,page,pageSize,totalPages:Math.max(1,Math.ceil(posts.length/pageSize))});
  }
  if (request.method === 'POST' && url.pathname === '/api/posts') {
    const body = await requestJson(request);
    const category = (await config.categories()).value[0];
    return json({ post: await store.createDraft(category, body.kind ?? 'post') }, 201);
  }
  const match = url.pathname.match(/^\/api\/posts\/([^/]+)(?:\/(preview|publish|media))?$/u);
  if (!match || !validAdminPostId(match[1])) return notFound(request);
  const [, id, action] = match;
  if (request.method === 'GET' && !action) {
    const post = await store.getForAdmin(id);
    return post ? json({ post }) : json({ error: '찾을 수 없습니다.' }, 404);
  }
  if (request.method === 'DELETE' && !action) {const body=await requestJson(request);return json(await store.deleteEmptyDraft(id,Number(body.expectedRevision)));}
  if (request.method === 'PUT' && !action) {
    const body = await requestJson(request);
    return json({ post: await store.update(id, Number(body.expectedRevision), body.input) });
  }
  if (request.method === 'POST' && action === 'preview') {
    const body = await requestJson(request);
    const post = await store.getForAdmin(id);
    if (!post) return json({ error: '찾을 수 없습니다.' }, 404);
    const editorHtml = (await store.normalizeInput(body.input, post)).bodyHtml;
    const html = prepareImportedPresentation(editorHtml,post.source&&post.sourceId?{source:post.source,sourceId:post.sourceId}:undefined);
    return json({ html, editorHtml, css: IMPORTED_PRESENTATION_CSS + (html.includes('data-engine-diagram') ? ENGINE_DIAGRAM_CSS : '') });
  }
  if (request.method === 'POST' && action === 'publish') {
    const body = await requestJson(request);
    return json({ post: await store.publish(id, Number(body.expectedRevision), body) });
  }
  if (request.method === 'GET' && action === 'media') return json({ media: await store.mediaForPost(id) });
  if (request.method === 'POST' && action === 'media') {
    const mime = request.headers.get('content-type')?.split(';', 1)[0].toLowerCase() ?? '';
    const extension = MIME_EXTENSIONS.get(mime);
    const bytes = Number(request.headers.get('x-dwnc-file-size') ?? '');
    const sha256 = request.headers.get('x-dwnc-file-sha256')?.toLowerCase() ?? '';
    if (!extension || !Number.isSafeInteger(bytes) || bytes < 1 || bytes > MAX_IMAGE_BYTES
      || !/^[a-f0-9]{64}$/u.test(sha256) || !request.body) throw new Error('ADMIN_E_MEDIA');
    const post = await store.getForAdmin(id);
    if (!post || post.status === 'tombstone') throw new Error('NATIVE_E_MEDIA_POST');
    const body = await boundedBody(request,MAX_IMAGE_BYTES);
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
  if (error instanceof Error && error.message === 'ADMIN_E_HTML_PASTE') return json({error:'HTML 내용을 확인해 주세요.',code:'invalid_html_paste'},400);
  const code = error instanceof Error ? error.message : '';
  if (code === 'ADMIN_E_STATISTICS_RANGE') return json({error:'날짜는 시작일 순서대로, 오늘까지 최대 366일 범위로 지정해 주세요.'},400);
  if (code === 'NATIVE_E_PUBLIC_CATEGORY') return json({error:'공개하려면 블로그의 카테고리를 먼저 선택해 주세요.',code:'public_category_required'},400);
  if (code === 'NATIVE_E_REVISION') return json({ error: '다른 변경이 먼저 저장되었습니다. 현재 작성 내용은 유지됩니다.', code: 'revision_conflict' }, 409);
  if (code === 'NATIVE_E_CATEGORY_IN_USE') return json({error:'글에서 사용 중인 카테고리는 삭제할 수 없습니다. 해당 글의 카테고리를 먼저 변경해 주세요.',code:'category_in_use'},400);
  if (code === 'NATIVE_E_NOT_EMPTY') return json({error:'내용이나 사진이 있는 글은 여기서 삭제할 수 없습니다. 비어 있는 새 초안만 삭제할 수 있습니다.'},400);
  if (code === 'NATIVE_E_KIND_LOCKED') return json({error:'한 번 발행한 글은 주소를 유지하기 위해 종류를 변경할 수 없습니다.'},400);
  if (code === 'NATIVE_E_PASSWORD') return json({error:'보호 글 비밀번호는 8~128자로 입력해 주세요.'},400);
  if (code === 'NATIVE_E_SCHEDULE') return json({error:'예약 시각은 현재보다 미래로 지정해 주세요.'},400);
  if (code === 'NATIVE_E_TEMPLATE_MEDIA') return json({error:'사진은 글마다 소유가 다르므로 서식에는 포함할 수 없습니다. 사진을 제외한 서식을 저장해 주세요.'},400);
  if (code.startsWith('NATIVE_E_') || code.startsWith('ADMIN_E_')) return json({ error: '입력 내용을 확인해 주세요.' }, 400);
  console.error(JSON.stringify({ event: 'dwnc_admin_error', code: 'ADMIN_E_INTERNAL' }));
  return json({ error: '잠시 후 다시 시도해 주세요.' }, 500);
}

export default {
  async fetch(request: Request, env: AdminEnvironment, context: ExecutionContext): Promise<Response> {
    // A simple credentialed GET uses the existing admin-origin Access cookie.
    // Only this boolean response is readable by the public site; no identity or token crosses origins.
    const url = new URL(request.url);
    if (url.pathname === '/api/session') {
      const origin = request.headers.get('origin');
      const allowedOrigin = origin === 'https://dwnc.me';
      const reply = (authenticated: boolean, status: number) => {
        const response = json({ authenticated }, status);
        response.headers.set('vary', 'Origin');
        if (allowedOrigin) {
          response.headers.set('access-control-allow-origin', 'https://dwnc.me');
          response.headers.set('access-control-allow-credentials', 'true');
        }
        return response;
      };
      if (request.method !== 'GET') return reply(false, 405);
      if (url.search || url.hash || origin && !allowedOrigin && origin !== url.origin) return reply(false, 403);
      try { await verifyAccessIdentity(request, env, { strictExpiry: true }); }
      catch { return reply(false, 401); }
      return reply(true, 200);
    }
    let identity;
    try { identity = await verifyAccessIdentity(request, env); }
    catch { return json({ error: '로그인이 필요합니다.', code: 'authentication_required' }, 401); }
    try { return await route(request, env, identity.email, context); }
    catch (error) { return errorResponse(error); }
  },
} satisfies ExportedHandler<AdminEnvironment>;
