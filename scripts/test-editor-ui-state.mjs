import assert from 'node:assert/strict';
import { createContext, runInContext } from 'node:vm';
import { load } from 'cheerio';
import { adminHtml } from '../src/lib/admin-ui.ts';
import { NativePostStore } from '../src/lib/native-post-store.ts';
import { createEditorDatabase } from './fixtures/editor-database.mjs';

// Lightweight DOM for executable editor state tests. Layout and native selection
// are checked separately in the browser fixture using the same emitted HTML.
class Element {
  value = ''; textContent = ''; innerHTML = ''; children = []; dataset = {}; style = { setProperty() {} }; listeners = {}; hidden = false; disabled = false; files = [];
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  setAttribute(name, value) { this[name] = value; }
  addEventListener(name, handler) { (this.listeners[name] ??= []).push(handler); }
  querySelectorAll(selector) { return this.children.flatMap((child) => [...(child.tag === selector ? [child] : []), ...child.querySelectorAll(selector)]); }
  contains(node) { return this.children.includes(node); }
  focus() {}
  getBoundingClientRect() { return { height: 40, width: 500, top: 0, left: 0, bottom: 40, right: 500 }; }
  setRangeText(text, start = 0, end = 0) { this.value = this.value.slice(0, start) + text + this.value.slice(end); }
  emit(name) { for (const handler of this.listeners[name] ?? []) handler({ target: this, preventDefault() {} }); }
}
const database = await createEditorDatabase();
const store = new NativePostStore(database);
const draft = await store.createDraft({ id: 'daily', slug: '일상', label: '일상' });
const input = { title: '원래 제목', description: '설명', bodyMarkdown: '본문', categoryId: 'daily', tags: [], coverMediaId: null };
const saved = await store.update(draft.id, 0, input);
const published = await store.publish(draft.id, saved.revision);
const html = load(adminHtml('owner@example.test'));
const elements = new Map(html('[id]').toArray().map((node) => [node.attribs.id, Object.assign(new Element(), { hidden: 'hidden' in node.attribs, disabled: 'disabled' in node.attribs })]));
let failure = null;
let holdSave = null;
let holdPublish = null;
let saveStarted;
const requests = [];
const document = { getElementById: (id) => elements.get(id), createElement: (tag) => Object.assign(new Element(), { tag }), addEventListener() {}, querySelector: () => new Element() };
const context = createContext({ document, Element, window: { addEventListener() {}, innerHeight: 800, innerWidth: 1200 }, Date, Error, console, Response, AbortController, setTimeout: () => 1, clearTimeout() {}, fetch: async (path, options = {}) => {
  requests.push({ path, method: options.method ?? 'GET', body: options.body ? JSON.parse(options.body) : null });
  if (failure) {
    const status = failure; failure = null;
    if (status === 'network') throw new TypeError('Synthetic offline');
    if (status === 'redirect') return new Response(null, { status: 302 });
    if (status === 'html') return new Response('<html>Login</html>', { headers: { 'content-type': 'text/html' } });
    return Response.json({ error: '합성 오류', code: status === 401 ? 'authentication_required' : 'request_failed' }, { status });
  }
  const id = path.split('/')[3];
  try {
    if (options.method === 'PUT') {
      const { expectedRevision, input } = JSON.parse(options.body);
      if (holdSave) { saveStarted?.(); await holdSave; holdSave = null; }
      return Response.json({ post: await store.update(id, expectedRevision, input) });
    }
    if (path.endsWith('/publish')) { if (holdPublish) await holdPublish; return Response.json({ post: await store.publish(id, JSON.parse(options.body).expectedRevision) }); }
    if (path === '/api/posts') return Response.json({ posts: await store.listForAdmin() });
    return Response.json({ post: await store.getForAdmin(id) });
  } catch (error) { return Response.json({ error: error.message, code: 'revision_conflict' }, { status: 409 }); }
} });
runInContext(html('script').text(), context);
const tick = () => new Promise((resolve) => setImmediate(resolve));
await tick();
runInContext(`fill(${JSON.stringify(published)})`, context);
const field = (id) => elements.get(id);
assert.equal(field('bodyHtml').innerHTML, published.bodyHtml);
assert.equal(field('body').hidden, true);
assert.equal(requests.some((request) => request.method === 'PUT'), false);
assert.equal((await store.getPublishedBySequence(597)).bodyFormat, 'markdown');
const edit = (title) => { field('title').value = title; field('title').emit('input'); };
const flush = () => runInContext('flush()', context);

edit('자동저장 작업본'); await flush();
assert.equal((await store.getForAdmin(draft.id)).title, '자동저장 작업본');
assert.equal((await store.getForAdmin(draft.id)).bodyFormat, 'html');
assert.equal((await store.getForAdmin(draft.id)).bodyHtml, published.bodyHtml);
assert.equal((await store.getPublishedBySequence(597)).title, '원래 제목');
assert.match(field('saveStatus').textContent, /공개 반영을 기다리는/u);
assert.match(field('lastSaved').textContent, /마지막 저장 성공/u);

failure = 500; edit('저장 실패에도 남는 입력'); await flush();
assert.equal(field('title').value, '저장 실패에도 남는 입력');
assert.equal(field('saveIssue').hidden, false);
await field('retrySave').onclick();
assert.equal((await store.getForAdmin(draft.id)).title, '저장 실패에도 남는 입력');
assert.equal(field('saveIssue').hidden, true);

failure = 401; edit('로그인 만료 중 입력'); await flush();
assert.equal(field('title').value, '로그인 만료 중 입력');
assert.match(field('saveStatus').textContent, /로그인 필요/u);
await field('resumeLogin').onclick();
assert.equal((await store.getForAdmin(draft.id)).title, '로그인 만료 중 입력');

for (const kind of ['network', 'redirect', 'html']) {
  failure = kind; edit(`응답 ${kind}에도 유지`); await flush();
  assert.equal(field('title').value, `응답 ${kind}에도 유지`);
  if (kind === 'network') await field('retrySave').onclick();
  else {
    failure = 401; await field('resumeLogin').onclick();
    assert.equal(field('title').value, `응답 ${kind}에도 유지`);
    await field('resumeLogin').onclick();
  }
  assert.equal((await store.getForAdmin(draft.id)).title, `응답 ${kind}에도 유지`);
}

let latest = await store.getForAdmin(draft.id);
await store.update(draft.id, latest.revision, { ...input, title: '다른 탭의 내용' });
edit('내가 유지할 내용'); await flush();
assert.equal(field('title').value, '내가 유지할 내용');
assert.equal(field('keepLocal').hidden, false);
const savedTimeBeforeKeep = field('lastSaved').textContent;
await field('keepLocal').onclick();
assert.equal(field('lastSaved').textContent, savedTimeBeforeKeep);
assert.equal(field('title').value, '내가 유지할 내용');
assert.equal((await store.getForAdmin(draft.id)).title, '다른 탭의 내용');
edit('검토 중에도 유지할 내용'); await flush();
assert.equal((await store.getForAdmin(draft.id)).title, '다른 탭의 내용');
await field('retrySave').onclick();
assert.equal((await store.getForAdmin(draft.id)).title, '검토 중에도 유지할 내용');

latest = await store.getForAdmin(draft.id);
await store.update(draft.id, latest.revision, { ...input, title: '불러올 최신본' });
edit('버릴 작업본'); await flush(); await field('loadLatest').onclick();
assert.equal(field('title').value, '불러올 최신본');

// A second input made while autosave is in flight must get its own later save.
let releaseSave;
holdSave = new Promise((resolve) => { releaseSave = resolve; });
const started = new Promise((resolve) => { saveStarted = resolve; });
edit('전송 중인 입력'); const runningSave = flush(); await started;
edit('전송 중 추가한 최신 입력'); releaseSave(); await runningSave;
assert.equal((await store.getForAdmin(draft.id)).title, '전송 중 추가한 최신 입력');
assert.equal(field('title').value, '전송 중 추가한 최신 입력');

// Explicit publish flushes dirty input, publishes that revision, and locks edits.
const requestOffset = requests.length;
let releasePublish;
holdPublish = new Promise((resolve) => { releasePublish = resolve; });
edit('공개 버튼 직전 미저장 입력');
const publishing = field('publish').onclick();
await tick();
assert.equal(field('title').disabled, true);
assert.equal(field('bodyHtml').contentEditable, 'false');
assert.equal(field('new').disabled, true);
releasePublish(); await publishing; holdPublish = null;
assert.equal((await store.getPublishedBySequence(597)).title, '공개 버튼 직전 미저장 입력');
const publishRequests = requests.slice(requestOffset).filter((request) => request.method !== 'GET');
assert.deepEqual(publishRequests.map((request) => request.method), ['PUT', 'POST']);
assert.equal(publishRequests[1].body.expectedRevision, publishRequests[0].body.expectedRevision + 1);
assert.equal(field('title').disabled, false);
assert.match(field('saveStatus').textContent, /공개 내용과 같습니다/u);

// A competing save between flush and publish is rejected without changing the
// public snapshot or replacing the user's form with the competing session.
holdPublish = new Promise((resolve) => { releasePublish = resolve; });
edit('공개 대기 중인 내 작성본');
const conflictingPublish = field('publish').onclick();
await tick();
latest = await store.getForAdmin(draft.id);
await store.update(draft.id, latest.revision, { ...input, title: '공개 직전 다른 세션의 저장' });
releasePublish(); await conflictingPublish; holdPublish = null;
assert.equal((await store.getPublishedBySequence(597)).title, '공개 버튼 직전 미저장 입력');
assert.equal(field('title').value, '공개 대기 중인 내 작성본');
assert.equal(field('keepLocal').hidden, false);

console.log(JSON.stringify({ suite: 'editor-ui-state', status: 'PASS', behavior: 'actual emitted UI, autosave isolation, failure retry, login continuation, conflict choices, in-flight edit, flush-before-publish and edit lock' }));
