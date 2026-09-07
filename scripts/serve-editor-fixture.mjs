// Local-only synthetic editor scenario server. No external data or credentials.
import { createServer } from 'node:http';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import adminWorker from '../src/admin-worker.ts';
import { NativePostStore } from '../src/lib/native-post-store.ts';
import { createEditorDatabase, seedLegacy } from './fixtures/editor-database.mjs';

const database = await createEditorDatabase();
const legacyImage = seedLegacy(database);
const store = new NativePostStore(database);
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
const counts = { saves: 0, publishes: 0 };
const controls = `<!doctype html><html lang="ko"><meta charset="utf-8"><title>합성 CMS 시험</title><style>body{font:18px sans-serif;max-width:900px;margin:40px auto}a{display:block;margin:18px}</style><h1>로컬 합성 CMS 시험</h1><a href="/" target="editor">관리자 열기</a><a href="/__fixture/public" target="public">방문자 사본 확인</a>${[['fail','다음 저장 실패'],['auth','로그인 만료'],['conflict','다른 세션에서 수정'],['slow','다음 저장 3초 지연'],['slow-publish','다음 공개 반영 3초 지연'],['normal','정상으로 전환']].map(([key,label])=>`<a href="/__fixture/action/${key}">${label}</a>`).join('')}<a href="/__fixture/state">현재 합성 데이터</a></html>`;
const server = createServer(async (incoming, outgoing) => {
  try {
    const url = new URL(incoming.url, 'http://127.0.0.1:4322');
    let response;
    if (url.pathname === '/__fixture') response = new Response(controls, { headers: { 'content-type': 'text/html; charset=utf-8' } });
    else if (url.pathname === '/__fixture/state') response = Response.json({ mode, counts, admin: await store.listForAdmin(), published: (await store.listPublished()).map(({ id, title, revision, bodyMarkdown }) => ({ id, title, revision, bodyMarkdown })) });
    else if (url.pathname === '/__fixture/public') {
      const posts = await store.listPublished();
      response = new Response(`<html lang="ko"><meta charset="utf-8"><title>방문자 합성 화면</title>${posts.map((post)=>`<article><h1>${post.title.replaceAll('<','&lt;')}</h1>${post.bodyHtml}</article>`).join('')}</html>`, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
    } else if (url.pathname.startsWith('/__fixture/action/')) {
      mode = url.pathname.split('/').at(-1);
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
    outgoing.writeHead(response.status, Object.fromEntries(response.headers));
    outgoing.end(Buffer.from(await response.arrayBuffer()));
  } catch { outgoing.writeHead(500); outgoing.end('Synthetic fixture error'); }
});
server.listen(4322, '127.0.0.1', () => console.log('Synthetic editor fixture: http://127.0.0.1:4322/__fixture'));
