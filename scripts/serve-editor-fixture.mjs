// Local-only synthetic editor scenario server. No external data or credentials.
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import adminWorker from '../src/admin-worker.ts';
import { createNativePublicWorker } from '../src/lib/native-public-worker.ts';
import { load } from 'cheerio';
import ts from 'typescript';
import { NativePostStore } from '../src/lib/native-post-store.ts';
import { createEditorDatabase, seedLegacy } from './fixtures/editor-database.mjs';

const database = await createEditorDatabase();
const legacyImage = seedLegacy(database);
const store = new NativePostStore(database);
// Minimal local HTMLRewriter equivalent for the selectors used by the public
// Worker. It transforms synthetic HTML, never imported article source.
class FixtureHTMLRewriter {
  handlers = [];
  on(selector, handler) { this.handlers.push([selector, handler]); return this; }
  async transform(response) {
    const $ = load(await response.text());
    for (const [selector, handler] of this.handlers) {
      for (const node of $(selector).toArray()) {
        await handler.element({
          setInnerContent: (value, options = {}) => options.html ? $(node).html(value) : $(node).text(value),
          setAttribute: (name, value) => $(node).attr(name, value),
          removeAttribute: (name) => $(node).removeAttr(name),
          remove: () => $(node).remove(),
          append: (value, options = {}) => $(node).append(options.html ? value : $('<span>').text(value).html()),
        });
      }
    }
    return new Response($.html(), { status: response.status, headers: response.headers });
  }
}
globalThis.HTMLRewriter = FixtureHTMLRewriter;
// A long synthetic list exposes small-screen navigation without real posts.
for (let index = 1; index <= 40; index += 1) {
  const draft = await store.createDraft({ id: 'daily', slug: '일상', label: '일상' });
  await store.update(draft.id, draft.revision, {
    title: `목록 시험 ${String(index).padStart(2, '0')}`,
    description: '합성 목록 화면 시험', bodyMarkdown: '합성 목록 시험용 본문입니다.',
    categoryId: 'daily', tags: [], coverMediaId: null,
  });
}
const imageBytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aMnoAAAAASUVORK5CYII=', 'base64');
const objects = new Map();
const bucket = {
  async put(key, body, options) {
    const bytes = Buffer.from(await new Response(body).arrayBuffer());
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const object = { key, bytes, size: bytes.length, customMetadata: options.customMetadata, httpMetadata: options.httpMetadata, httpEtag: '"fixture"', checksums: { sha256: Uint8Array.from(Buffer.from(sha256, 'hex')).buffer } };
    objects.set(key, object); return object;
  },
  async get(key) { const object = objects.get(key); return object ? { ...object, body: object.bytes } : null; },
  async head(key) { return objects.get(key) ?? null; },
};
const legacyImageSha = createHash('sha256').update(imageBytes).digest('hex');
await bucket.put(legacyImage.slice(1),imageBytes,{sha256:legacyImageSha,httpMetadata:{contentType:'image/png'},customMetadata:{sha256:legacyImageSha,contract:'dwnc-native-media-v1'}});
await store.addMedia({id:'123e4567-e89b-42d3-a456-426614174000',postId:'legacy-1',publicPath:legacyImage,objectKey:legacyImage.slice(1),sha256:legacyImageSha,bytes:imageBytes.length,mime:'image/png',alt:'합성 시험 이미지',createdAt:'2026-09-01T00:00:00Z'});
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = Object.assign(publicKey.export({ format: 'jwk' }), { kid: 'fixture', alg: 'RS256', use: 'sig' });
const env = { ACCESS_TEAM_DOMAIN: 'https://fixture.cloudflareaccess.com', ACCESS_AUD: 'synthetic-editor-fixture-audience', ACCESS_ALLOWED_EMAIL: 'owner@example.test', NATIVE_DB: database, NATIVE_MEDIA_BUCKET: bucket, MEDIA_BUCKET: bucket };
const b64 = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
const jwtContent = `${b64({ alg: 'RS256', kid: 'fixture' })}.${b64({ iss: env.ACCESS_TEAM_DOMAIN, aud: env.ACCESS_AUD, sub: 'fixture', email: env.ACCESS_ALLOWED_EMAIL, exp: Math.floor(Date.now() / 1000) + 86400 })}`;
const syntheticAssertion = `${jwtContent}.${sign('RSA-SHA256', Buffer.from(jwtContent), privateKey).toString('base64url')}`;
globalThis.fetch = async (url) => {
  if (String(url) === `${env.ACCESS_TEAM_DOMAIN}/cdn-cgi/access/certs`) return Response.json({ keys: [jwk] });
  throw new Error('Fixture external fetch disabled');
};
let mode = 'normal';
let fixtureAdmin = false;
// Synthetic events exercise the real paste handler without OS clipboard access.
const pasteControls = `<aside style="position:fixed;left:12px;bottom:80px;z-index:1000;padding:8px;background:#fff;border:1px solid #999;font:13px sans-serif"><details><summary>합성 붙여넣기 시험</summary><button type="button" data-fixture-paste="image">이미지 붙여넣기 시험</button><button type="button" data-fixture-paste="html">HTML소스 붙여넣기 시험</button><p id="fixturePasteStatus" role="status"></p></details></aside><script>
document.querySelectorAll('[data-fixture-paste]').forEach(button=>button.addEventListener('click',()=>{
 const editor=document.getElementById('bodyHtml'),status=document.getElementById('fixturePasteStatus');
 if(!editor||!editor.getClientRects().length){status.textContent='먼저 HTML 글을 열어 주세요.';return;}
 editor.focus();const range=document.createRange();range.selectNodeContents(editor);range.collapse(false);const selection=window.getSelection();selection.removeAllRanges();selection.addRange(range);
 const transfer=new DataTransfer();
 if(button.dataset.fixturePaste==='image'){const bytes=Uint8Array.from(atob('${imageBytes.toString('base64')}'),value=>value.charCodeAt(0));transfer.items.add(new File([bytes],'synthetic-pasted.png',{type:'image/png'}));}
 else transfer.setData('text/plain','<h2>합성 HTML 제목</h2><p>붙여넣은 <strong>굵은 글씨</strong>와 <em>기울임</em>입니다.</p><ul><li>합성 목록 항목</li></ul>');
 const event=new ClipboardEvent('paste',{clipboardData:transfer,bubbles:true,cancelable:true});editor.dispatchEvent(event);status.textContent=event.defaultPrevented?'합성 붙여넣기를 전달했습니다. 본문과 저장 상태를 확인하세요.':'붙여넣기 처리기가 이벤트를 받지 않았습니다.';
}));</script>`;
const counts = { saves: 0, publishes: 0 };
const controls = `<!doctype html><html lang="ko"><meta charset="utf-8"><title>합성 CMS 시험</title><style>body{font:18px sans-serif;max-width:900px;margin:40px auto}a{display:block;margin:18px}</style><h1>로컬 합성 CMS 시험</h1><a href="/" target="editor">관리자 열기</a><a href="http://127.0.0.1:4324/" target="public">실제 공개 처리기로 합성 방문자 화면 확인</a><a href="/__fixture/public" target="public-raw">저장된 공개 사본 확인</a>${[['fail','다음 저장 실패'],['auth','로그인 만료'],['conflict','다른 세션에서 수정'],['slow','다음 저장 3초 지연'],['slow-publish','다음 공개 반영 3초 지연'],['normal','정상으로 전환']].map(([key,label])=>`<a href="/__fixture/action/${key}">${label}</a>`).join('')}<a href="/__fixture/state">현재 합성 데이터</a></html>`;
const fontFiles = new Set(['NanumGothic.woff','NanumGothicBold.ttf','NanumMyeongjo.woff','NanumMyeongjoBold.woff','NanumBarunGothic.woff','NanumBarunGothicBold.woff'].map(name=>'/fonts/nanum/'+name));
const server = createServer(async (incoming, outgoing) => {
  try {
    const url = new URL(incoming.url, 'http://127.0.0.1:4322');
    let response;
    if (url.pathname === '/api/session' && incoming.headers.origin === 'http://127.0.0.1:4324') response = Response.json({authenticated: fixtureAdmin}, {headers:{'access-control-allow-origin':'http://127.0.0.1:4324','access-control-allow-credentials':'true','cache-control':'no-store','vary':'Origin'}});
    else if (fontFiles.has(url.pathname)) response = new Response(await readFile(new URL('../public'+url.pathname,import.meta.url)),{headers:{'content-type':url.pathname.endsWith('.ttf')?'font/ttf':'font/woff'}});
    else if (url.pathname === '/__fixture') response = new Response(controls, { headers: { 'content-type': 'text/html; charset=utf-8' } });
    else if (url.pathname === '/__fixture/state') response = Response.json({ mode, counts, admin: await store.listForAdmin(), published: (await store.listPublished()).map(({ id, title, revision, bodyMarkdown }) => ({ id, title, revision, bodyMarkdown })) });
    else if (url.pathname === '/__fixture/public') {
      const posts = await store.listPublished();
      response = new Response(`<html lang="ko"><meta charset="utf-8"><title>방문자 합성 화면</title>${posts.map((post)=>`<article><h1>${post.title.replaceAll('<','&lt;')}</h1>${post.bodyHtml}</article>`).join('')}</html>`, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
    } else if (url.pathname.startsWith('/__fixture/action/')) {
      mode = url.pathname.split('/').at(-1);
      if (mode === 'admin-on' || mode === 'admin-off') { fixtureAdmin = mode === 'admin-on'; mode = 'normal'; }
      if (mode === 'conflict') {
        const post = await store.getForAdmin('legacy-1');
        await store.update(post.id, post.revision, { ...post, title: `다른 세션에서 저장한 제목 ${post.revision + 1}` });
        mode = 'normal';
      }
      response = new Response(controls.replace('<h1>', `<p>설정 완료: ${mode}</p><h1>`), { headers: { 'content-type': 'text/html; charset=utf-8' } });
    } else if (url.pathname === legacyImage) response = new Response(imageBytes, { headers: { 'content-type': 'image/png' } });
    else {
      if (url.pathname === '/' && incoming.method === 'GET') mode = mode === 'auth' ? 'normal' : mode;
      const isSave = incoming.method === 'PUT';
      const isPublish = url.pathname.endsWith('/publish');
      if (isSave) counts.saves += 1;
      if (isPublish) counts.publishes += 1;
      if (mode === 'auth') response = Response.json({ code: 'authentication_required', error: '로그인이 필요합니다.' }, { status: 401 });
      else if (mode === 'fail' && isSave) { mode = 'normal'; response = Response.json({ error: '시험용 저장 실패입니다.' }, { status: 500 }); }
      else {
        if ((mode === 'slow' && isSave) || (mode === 'slow-publish' && isPublish)) { mode = 'normal'; await new Promise((resolve) => setTimeout(resolve, 3000)); }
        const headers = new Headers(incoming.headers);
        headers.set('cf-access-jwt-assertion', syntheticAssertion);
        const buffers = []; for await (const chunk of incoming) buffers.push(chunk);
        const request = new Request(url, { method: incoming.method, headers, ...(!['GET', 'HEAD'].includes(incoming.method) ? { body: Buffer.concat(buffers) } : {}) });
        response = await adminWorker.fetch(request, env, { waitUntil() {} });
      }
    }
    if (url.pathname === '/' && response.ok && response.headers.get('content-type')?.includes('text/html')) {
      const headers = new Headers(response.headers); headers.delete('content-length');
      response = new Response((await response.text()).replace('</body>', pasteControls + '</body>'), { status: response.status, headers });
    }
    outgoing.writeHead(response.status, Object.fromEntries(response.headers));
    outgoing.end(Buffer.from(await response.arrayBuffer()));
  } catch { outgoing.writeHead(500); outgoing.end('Synthetic fixture error'); }
});
server.listen(4322, '127.0.0.1', () => console.log('Synthetic editor fixture: http://127.0.0.1:4322/__fixture'));

const publicCss = await readFile(new URL('../src/styles/global.css', import.meta.url), 'utf8');
// Only this local scenario rewrites the browser origin and session endpoint.
// Production accepts no localhost origin and the fixture calls no real admin API.
const adminComponent = await readFile(new URL('../src/components/AdminQuickLinks.astro', import.meta.url), 'utf8');
const adminMarkup = adminComponent.split('<script>')[0].replaceAll('https://admin.dwnc.me', 'http://127.0.0.1:4322');
const adminCss = adminComponent.match(/<style is:global>([\s\S]*?)<\/style>/u)?.[1] ?? '';
const adminBrowserSource = (await readFile(new URL('../src/lib/public-admin-links.ts', import.meta.url), 'utf8')).replaceAll('https://admin.dwnc.me','http://127.0.0.1:4322').replaceAll('https://dwnc.me','http://127.0.0.1:4324').replace(/^export /gmu,'');
const adminBrowserScript = ts.transpileModule(adminBrowserSource,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText + '\nmountPublicAdminLinks();';
const staticArticle = await store.getPublishedBySequence(1);
const syntheticIndex = [{ title: staticArticle.title, description: staticArticle.description, path: '/posts/1', date: '2026.09.01', publishedAt: staticArticle.publishedAt, updatedAt: staticArticle.updatedAt, featured: true, cover: legacyImage, coverAlt: '합성 시험 이미지', categoryId: 'daily', categories: ['일상'], tags: [], categoryPath: ['일상'], leafCategory: { label: '일상', path: '/category/일상' }, searchText: '합성 기존 공개 글 방문자에게 보이는 원래 본문입니다.' }];
const syntheticShell = (main = '') => `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>합성 공개 화면</title><meta name="description"><link rel="canonical"><meta property="og:title"><meta property="og:description"><meta property="og:url"><meta property="og:site_name"><meta property="og:type"><meta name="twitter:card"><link rel="stylesheet" href="/__fixture/global.css"></head><body><header class="site-header"><div class="shell"><a class="brand" href="/">합성 블로그</a><span class="site-header__note"></span><nav class="site-nav"></nav></div></header><main id="main">${main}</main><dialog id="category-drawer"><nav></nav></dialog><footer class="site-footer"><div class="site-footer__inner shell"><p><a href="/"></a><span></span></p><div class="site-footer__links"><span></span></div></div></footer></body></html>`;
const publicHandler = createNativePublicWorker(async (request) => {
  const path = new URL(request.url).pathname;
  const html = body => new Response(request.method === 'HEAD' ? null : syntheticShell(body).replace('<main id="main">',`${adminMarkup}<main id="main">`).replace('</head>',`<style>${adminCss}</style><script src="/__fixture/admin-links.js" defer></script></head>`), { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
  if (path === '/search-index.json') return Response.json(syntheticIndex);
  if (path === '/1') return new Response(null, { status: 308, headers: { location: '/posts/1' } });
  if (['/posts/1', '/posts/1/', '/posts/1/index.html', '/posts/1.html'].includes(path)) return html(`<article class="prose"><h1>${staticArticle.title}</h1>${staticArticle.bodyHtml}</article>`);
  if (path === '/' || path === '/about') return html('<section class="shell"><h1>합성 소개</h1><p>실제 자료가 없는 로컬 시험입니다.</p></section>');
  return new Response(request.method === 'HEAD' ? null : 'Not found.', { status: 404, headers: { 'cache-control': 'no-store' } });
});
const publicServer = createServer(async (incoming, outgoing) => {
  try {
    const url = new URL(incoming.url, 'http://127.0.0.1:4324');
    let response;
    if (url.pathname === '/__fixture/global.css') response = new Response(publicCss, { headers: { 'content-type': 'text/css' } });
    else if (url.pathname === '/__fixture/admin-links.js') response = new Response(adminBrowserScript, {headers:{'content-type':'text/javascript','cache-control':'no-store'}});
    else if (fontFiles.has(url.pathname)) response = new Response(await readFile(new URL('../public' + url.pathname, import.meta.url)), { headers: { 'content-type': url.pathname.endsWith('.ttf') ? 'font/ttf' : 'font/woff' } });
    else {
      const buffers = []; for await (const chunk of incoming) buffers.push(chunk);
      const request = new Request(url, { method: incoming.method, headers: new Headers(incoming.headers), ...(!['GET', 'HEAD'].includes(incoming.method) ? { body: Buffer.concat(buffers) } : {}) });
      response = await publicHandler(request, env, { waitUntil() {} });
    }
    outgoing.writeHead(response.status, Object.fromEntries(response.headers));
    outgoing.end(incoming.method === 'HEAD' ? undefined : Buffer.from(await response.arrayBuffer()));
  } catch { outgoing.writeHead(500); outgoing.end('Synthetic public fixture error'); }
});
publicServer.listen(4324, '127.0.0.1', () => console.log('Synthetic public fixture: http://127.0.0.1:4324/'));
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => { server.close(); publicServer.close(); });
