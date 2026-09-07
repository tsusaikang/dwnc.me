import assert from 'node:assert/strict';
import { createContext, runInContext } from 'node:vm';
import { load } from 'cheerio';
import { adminHtml } from '../src/lib/admin-ui.ts';
import { CmsConfigurationStore } from '../src/lib/cms-configuration.ts';
import { webcrypto } from 'node:crypto';
import { NativePostStore } from '../src/lib/native-post-store.ts';
import { normalizeEditorPostInput } from '../src/lib/native-content.ts';
import { createEditorDatabase } from './fixtures/editor-database.mjs';

// Lightweight DOM for executable editor state tests. Layout and native selection
// are checked separately in the browser fixture using the same emitted HTML.
class Element {
  value = ''; textContent = ''; innerHTML = ''; children = []; dataset = {}; style = { setProperty() {} }; listeners = {}; hidden = false; disabled = false; files = [];
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  setAttribute(name, value) { this[name] = value; }
  removeAttribute(name) { delete this[name]; }
  addEventListener(name, handler) { (this.listeners[name] ??= []).push(handler); }
  querySelectorAll(selector) { const attribute = selector.match(/^\[([^=]+)="([^"]*)"\]$/); return this.children.filter(child => child instanceof Element).flatMap((child) => [...((attribute ? child[attribute[1]] === attribute[2] : child.tag === selector) ? [child] : []), ...child.querySelectorAll(selector)]); }
  querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
  contains(node) { return this.children.includes(node); }
  focus(options) { this.focused = true; this.focusOptions = options; }
  scrollIntoView(options) { this.scrollCalls = (this.scrollCalls ?? 0) + 1; this.scrollOptions = options; }
  showModal() { this.open = true; }
  close() { this.open = false; this.emit('close'); }
  getBoundingClientRect() { return { height: 40, width: 500, top: 0, left: 0, bottom: 40, right: 500 }; }
  setRangeText(text, start = 0, end = 0) { this.value = this.value.slice(0, start) + text + this.value.slice(end); }
  emit(name) { for (const handler of this.listeners[name] ?? []) handler({ target: this, preventDefault() {} }); }
}
const database = await createEditorDatabase();
const store = new NativePostStore(database);
const configuration = new CmsConfigurationStore(database);
const draft = await store.createDraft({ id: 'daily', slug: '일상', label: '일상' });
const input = { title: '원래 제목', description: '설명', bodyMarkdown: '본문', categoryId: 'daily', tags: [], coverMediaId: null };
const saved = await store.update(draft.id, 0, input);
const published = await store.publish(draft.id, saved.revision);
const otherDraft = await store.createDraft({ id: 'daily', slug: '일상', label: '일상' });
const html = load(adminHtml('owner@example.test'));
const elements = new Map(html('[id]').toArray().map((node) => [node.attribs.id, Object.assign(new Element(), { hidden: 'hidden' in node.attribs, disabled: 'disabled' in node.attribs })]));
let failure = null;
let holdSave = null;
let holdPublish = null;
let saveStarted;
const requests = [];
const document = { body: new Element(), documentElement: new Element(), getElementById: (id) => elements.get(id), createElement: (tag) => Object.assign(new Element(), { tag }), addEventListener() {}, querySelector: () => new Element() };
const window = { addEventListener() {}, innerHeight: 800, innerWidth: 1200, scrollY: 0, scrollTo({ top }) { this.scrollY = top; }, getSelection: () => ({ rangeCount: 0 }) };
const context = createContext({ document, Element, window, Date, Error, console, Response, AbortController, URLSearchParams, URL, structuredClone, crypto:webcrypto, setTimeout: () => 1, clearTimeout() {}, fetch: async (path, options = {}) => {
  requests.push({ path, method: options.method ?? 'GET', body: options.body ? JSON.parse(options.body) : null });
  if (failure) {
    const status = failure; failure = null;
    if (status === 'network') throw new TypeError('Synthetic offline');
    if (status === 'redirect') return new Response(null, { status: 302 });
    if (status === 'html') return new Response('<html>Login</html>', { headers: { 'content-type': 'text/html' } });
    return Response.json({ error: '합성 오류', code: status === 401 ? 'authentication_required' : 'request_failed' }, { status });
  }
  const requestPath=new URL(path,'http://fixture.invalid').pathname;
  const id = requestPath.split('/')[3];
  try {
    if(requestPath==='/api/categories'){const result=options.method==='PUT'?await configuration.saveCategories(JSON.parse(options.body).expectedRevision,JSON.parse(options.body).categories):await configuration.categories();return Response.json({categories:result.value,revision:result.revision});}
    if(requestPath==='/api/settings'){const result=options.method==='PUT'?await configuration.saveSettings(JSON.parse(options.body).expectedRevision,JSON.parse(options.body).settings):await configuration.settings();return Response.json({settings:result.value,revision:result.revision});}
    if(requestPath==='/api/tags')return Response.json({tags:[]});
    if(requestPath.endsWith('/media'))return Response.json({media:await store.mediaForPost(id)});
    if (options.method === 'PUT') {
      const { expectedRevision, input } = JSON.parse(options.body);
      if (holdSave) { saveStarted?.(); await holdSave; holdSave = null; }
      return Response.json({ post: await store.update(id, expectedRevision, input) });
    }
    if (path.endsWith('/publish')) { if (holdPublish) await holdPublish; return Response.json({ post: await store.publish(id, JSON.parse(options.body).expectedRevision) }); }
    if (path.endsWith('/preview')) return Response.json({ html: normalizeEditorPostInput(JSON.parse(options.body).input, await store.getForAdmin(id), { requirePublishable: false }).bodyHtml });
    if (path === '/api/posts' && options.method === 'POST') return Response.json({ post: await store.createDraft({ id: 'daily', slug: '일상', label: '일상' }) });
    if (requestPath === '/api/posts') return Response.json({ posts: await store.listForAdmin() });
    return Response.json({ post: await store.getForAdmin(id) });
  } catch (error) { return Response.json({ error: error.message, code: 'revision_conflict' }, { status: 409 }); }
} });
runInContext(html('script').text(), context);
const tick = () => new Promise((resolve) => setImmediate(resolve));
await tick();
const field = (id) => elements.get(id);
assert.equal(field('postsPanel').hidden, false);
assert.equal(field('editorView').hidden, true);
const postButton = field('posts').querySelectorAll('button').find((button) => button.dataset.postId === draft.id);
const otherPostButton = field('posts').querySelectorAll('button').find((button) => button.dataset.postId === otherDraft.id);
window.scrollY = 320;
await postButton.onclick();
assert.equal(field('heading').scrollCalls, 1);
assert.equal(field('title').focused, true);
assert.equal(postButton['aria-current'], 'true');
assert.equal(field('postsPanel').hidden, true);
assert.equal(field('editorView').hidden, false);
assert.equal(field('editorFooter').hidden, false);
const requestsBeforeListReturn = requests.length;
window.scrollY = 640;
await field('showPosts').onclick();
assert.equal(window.scrollY, 320);
assert.equal(field('postsPanel').hidden, false);
assert.equal(field('editorView').hidden, true);
assert.equal(field('editorFooter').hidden, true);
assert.equal(postButton.focused, true);
await field('resumeEditing').onclick();
assert.equal(window.scrollY, 640);
assert.equal(field('editorView').hidden, false);
assert.equal(requests.length, requestsBeforeListReturn);
assert.equal(field('bodyHtml').innerHTML, published.bodyHtml);
assert.equal(field('body').hidden, true);
assert.equal(requests.some((request) => request.method === 'PUT'), false);
assert.equal((await store.getPublishedBySequence(597)).bodyFormat, 'markdown');
const edit = (title) => { field('title').value = title; field('title').emit('input'); };
const flush = () => runInContext('flush()', context);

edit('목록 왕복 중 미저장 제목');
const workingBody = '<p>목록 왕복 중 <strong>작성 본문</strong> 유지</p>';
field('bodyHtml').innerHTML = workingBody; field('bodyHtml').emit('input');
const requestsBeforeDirtyReturn = requests.length;
await field('showPosts').onclick(); await postButton.onclick();
assert.equal(field('title').value, '목록 왕복 중 미저장 제목');
assert.equal(field('bodyHtml').innerHTML, workingBody);
assert.equal(requests.length, requestsBeforeDirtyReturn);

edit('자동저장 작업본'); await flush();
assert.equal((await store.getForAdmin(draft.id)).title, '자동저장 작업본');
assert.equal((await store.getForAdmin(draft.id)).bodyFormat, 'html');
assert.equal((await store.getForAdmin(draft.id)).bodyHtml, workingBody);
assert.equal((await store.getPublishedBySequence(597)).title, '원래 제목');
assert.match(field('saveStatus').textContent, /공개 반영을 기다리는/u);
assert.match(field('lastSaved').textContent, /마지막 저장 성공/u);

// Preview saves the current work first, stays isolated from publication, and
// closes back to the editor without replacing its content or reading it again.
const previewRequestOffset = requests.length;
edit('미리보기 직전 미저장 제목');
await field('preview').onclick();
assert.deepEqual(requests.slice(previewRequestOffset).filter((request) => request.method !== 'GET').map((request) => request.method), ['PUT', 'POST']);
assert.equal(field('previewDialog').open, true);
assert.equal(field('previewClose').focused, true);
assert.equal(field('previewTitle').textContent, '미리보기 직전 미저장 제목');
assert.equal(field('previewBox').innerHTML, workingBody);
assert.equal(field('previewViewport').dataset.size, 'desktop');
assert.equal((await store.getPublishedBySequence(597)).title, '원래 제목');
const requestsBeforePreviewControls = requests.length;
await field('previewMobile').onclick();
assert.equal(field('previewViewport').dataset.size, 'mobile');
assert.equal(field('previewMobile')['aria-pressed'], 'true');
await field('previewDesktop').onclick();
assert.equal(field('previewViewport').dataset.size, 'desktop');
field('preview').focused = false;
await field('previewClose').onclick();
assert.equal(field('previewDialog').open, false);
assert.equal(field('previewBox').hidden, true);
assert.equal(field('preview').focused, true);
assert.equal(field('bodyHtml').innerHTML, workingBody);
assert.equal(requests.length, requestsBeforePreviewControls);
await field('preview').onclick();
const requestsBeforeEscape = requests.length;
field('preview').focused = false;
field('previewDialog').emit('cancel');
assert.equal(field('previewDialog').open, false);
assert.equal(field('preview').focused, true);
assert.equal(requests.length, requestsBeforeEscape);
await field('attachPhoto').onclick();
assert.equal(field('uploadPanel').hidden, false);
await field('closeUpload').onclick();
assert.equal(field('uploadPanel').hidden, true);
assert.equal(field('bodyHtml').innerHTML, workingBody);
assert.equal(requests.length, requestsBeforeEscape);

failure = 500; edit('저장 실패에도 남는 입력');
const editorScrollsBeforeFailure = field('heading').scrollCalls;
await field('showPosts').onclick(); await otherPostButton.onclick();
assert.equal(field('title').value, '저장 실패에도 남는 입력');
assert.equal(field('heading').scrollCalls, editorScrollsBeforeFailure);
assert.equal(field('saveIssue').hidden, false);
assert.equal(field('postsPanel').hidden, false);
await field('resumeEditing').onclick();
assert.equal(field('editorView').hidden, false);
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

await field('loadLatest').onclick();
await field('new').onclick();
assert.equal(field('editorView').hidden, false);
assert.equal(field('postsPanel').hidden, true);
assert.equal(field('title').value, '');
assert.equal((await store.listForAdmin()).length, 3);
assert.equal((await store.listPublished()).length, 1);

// Management forms keep their input on failure and require explicit resolution
// of a competing settings save, independently of the post working copy.
await field('showPosts').onclick();
await field('manageSettings').onclick();
assert.equal(field('managementDialog').open, true);
let settingsTitle = field('managementContent').querySelectorAll('input')[0];
settingsTitle.value = '합성 블로그 이름'; settingsTitle.oninput();
await field('closeManagement').onclick();await field('manageCategories').onclick();
await field('closeManagement').onclick();await field('manageSettings').onclick();
assert.equal(field('managementContent').querySelectorAll('input')[0].value,settingsTitle.value);
assert.equal(runInContext('hasManagementChanges()',context),true);
failure = 500;
await field('saveManagement').onclick();
assert.match(field('managementError').textContent, /합성 오류/u);
assert.equal(field('managementContent').querySelectorAll('input')[0].value, '합성 블로그 이름');
assert.notEqual((await configuration.settings()).value.title, '합성 블로그 이름');
await field('saveManagement').onclick();
assert.equal((await configuration.settings()).value.title, '합성 블로그 이름');
settingsTitle = field('managementContent').querySelectorAll('input')[0];
settingsTitle.value = '이 화면의 설정'; settingsTitle.oninput();
const remoteSettings = await configuration.settings();
await configuration.saveSettings(remoteSettings.revision, { ...remoteSettings.value, title: '다른 화면의 설정' });
await field('saveManagement').onclick();
assert.match(field('managementError').textContent, /다른 곳/u);
assert.equal(field('managementContent').querySelectorAll('input')[0].value, '이 화면의 설정');
await field('keepManagement').onclick();
assert.equal((await configuration.settings()).value.title, '다른 화면의 설정');
assert.equal(field('saveManagement').textContent, '현재 입력으로 저장');
await field('saveManagement').onclick();
assert.equal((await configuration.settings()).value.title, '이 화면의 설정');
await field('closeManagement').onclick();
await field('manageCategories').onclick();
const categoryAdd = field('managementContent').querySelectorAll('button').find(button => button.textContent === '카테고리 추가');
categoryAdd.onclick();
const names = field('managementContent').querySelectorAll('input');
names.at(-1).value = '새 합성 갈래'; names.at(-1).oninput();
await field('saveManagement').onclick();
assert.ok((await configuration.categories()).value.some(category => category.label === '새 합성 갈래'));
assert.ok(field('category').children.some(option => option.textContent === '새 합성 갈래'));
await field('closeManagement').onclick();
await field('resumeEditing').onclick();
const activePost = await runInContext('current', context);
await store.addMedia({ id:'123e4567-e89b-42d3-a456-426614174012',postId:activePost.id,publicPath:'/media/native/123e4567-e89b-42d3-a456-426614174012.png',objectKey:'media/native/123e4567-e89b-42d3-a456-426614174012.png',sha256:'a'.repeat(64),bytes:1,mime:'image/png',alt:'합성 대표사진',createdAt:new Date().toISOString() });
await field('chooseCover').onclick();
assert.equal(field('coverDialog').open, true);
field('coverGrid').querySelectorAll('button')[0].onclick();
field('coverAlt').value = '직접 쓴 사진 설명';
await field('applyCover').onclick();
await flush();
assert.equal((await store.getForAdmin(activePost.id)).coverPath, '/media/native/123e4567-e89b-42d3-a456-426614174012.png');
assert.equal((await store.getForAdmin(activePost.id)).coverAlt, '직접 쓴 사진 설명');
assert.equal((await store.listPublished()).length, 1);
await field('chooseCover').onclick();
field('coverAlt').value = 'local cover description';
await field('applyCover').onclick();
const coverRemote = await store.getForAdmin(activePost.id);
await store.update(activePost.id, coverRemote.revision, { ...coverRemote, coverPath: null, coverAlt: 'remote cover description' });
await flush();
assert.equal(field('keepLocal').hidden, false);
await field('keepLocal').onclick();
assert.equal(runInContext('current.coverPath', context), '/media/native/123e4567-e89b-42d3-a456-426614174012.png');
assert.equal(runInContext('current.coverAlt', context), 'local cover description');
assert.equal((await store.getForAdmin(activePost.id)).coverPath, null);
await field('retrySave').onclick();
assert.equal((await store.getForAdmin(activePost.id)).coverAlt, 'local cover description');
assert.equal((await store.getForAdmin(activePost.id)).coverPath, '/media/native/123e4567-e89b-42d3-a456-426614174012.png');
field('postSearch').value='찾을 글';field('postCategory').value='daily';field('postStatus').value='changed';
await field('showPosts').onclick();await field('postStatus').onchange();await tick();
assert.ok(requests.some(request=>request.path.includes('q=%EC%B0%BE%EC%9D%84+%EA%B8%80')&&request.path.includes('categoryId=daily')&&request.path.includes('status=changed')));

console.log(JSON.stringify({ suite: 'editor-ui-state', status: 'PASS', behavior: 'actual emitted UI, preserved list/editor navigation, preview dialog and focus, autosave isolation, failure retry, login continuation, conflict choices, in-flight edit, flush-before-publish, edit lock and new post' }));
