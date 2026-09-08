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
const statisticsFixture={timezone:'Asia/Seoul',startDate:'2026-08-11',endDate:'2026-09-09',todayViews:3,totalViews:10,periodViews:7,daily:Array.from({length:30},(_,i)=>({date:new Date(Date.UTC(2026,7,11+i)).toISOString().slice(0,10),views:i===29?3:i===10?4:0})),posts:[{id:'stats-zero',title:'가나다 조회수 없는 합성 글',path:'/posts/900',views:0,totalViews:0},{id:'stats-active',title:'조회된 합성 글',path:'/posts/901',views:7,totalViews:10},...Array.from({length:23},(_,i)=>({id:'stats-'+i,title:'합성 글 '+String(i).padStart(2,'0'),path:i===0?null:'/posts/'+(902+i),views:0,totalViews:0}))]};
let statisticsResponse=statisticsFixture;
let failure = null;
let holdSave = null;
let holdPublish = null;
let saveStarted;
const requests = [];
const document = { body: new Element(), documentElement: new Element(), getElementById: (id) => elements.get(id), createElement: (tag) => Object.assign(new Element(), { tag }), addEventListener() {}, querySelector: () => new Element() };
const window = { location:{hash:''},listeners:{},addEventListener(name,handler) {this.listeners[name]=handler}, innerHeight: 800, innerWidth: 1200, scrollY: 0, scrollTo({ top }) { this.scrollY = top; }, getSelection: () => ({ rangeCount: 0 }) };
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
    if(requestPath==='/api/posts/resolve'){const wanted=new URL(path,'http://fixture.invalid').searchParams.get('path');const summaries=await store.listForAdmin();for(const summary of summaries){const post=await store.getForAdmin(summary.id);if(post?.publicPath===wanted)return Response.json({post})}return Response.json({error:'해당 글이 없습니다.',code:'post_not_found'},{status:404});}
    if(requestPath==='/api/statistics')return Response.json(statisticsResponse);
    if(requestPath==='/api/categories'){const result=options.method==='PUT'?await configuration.saveCategories(JSON.parse(options.body).expectedRevision,JSON.parse(options.body).categories):await configuration.categories();return Response.json({categories:result.value,revision:result.revision});}
    if(requestPath==='/api/settings'){const result=options.method==='PUT'?await configuration.saveSettings(JSON.parse(options.body).expectedRevision,JSON.parse(options.body).settings):await configuration.settings();return Response.json({settings:result.value,revision:result.revision});}
    if(requestPath==='/api/templates'){const result=options.method==='PUT'?await configuration.saveTemplates(JSON.parse(options.body).expectedRevision,JSON.parse(options.body).templates):await configuration.templates();return Response.json({templates:result.value,revision:result.revision});}
    if(options.method==='DELETE'){await store.deleteEmptyDraft(id,JSON.parse(options.body).expectedRevision);return Response.json({deleted:true});}
    if(requestPath==='/api/tags')return Response.json({tags:[]});
    if(requestPath.endsWith('/media'))return Response.json({media:await store.mediaForPost(id)});
    if (options.method === 'PUT') {
      const { expectedRevision, input } = JSON.parse(options.body);
      if (holdSave) { saveStarted?.(); await holdSave; holdSave = null; }
      return Response.json({ post: await store.update(id, expectedRevision, input) });
    }
    if (path.endsWith('/publish')) { if (holdPublish) await holdPublish; return Response.json({ post: await store.publish(id, JSON.parse(options.body).expectedRevision,JSON.parse(options.body)) }); }
    if (path.endsWith('/preview')) return Response.json({ html: normalizeEditorPostInput(JSON.parse(options.body).input, await store.getForAdmin(id), { requirePublishable: false }).bodyHtml });
    if (path === '/api/posts' && options.method === 'POST') return Response.json({ post: await store.createDraft({ id: 'daily', slug: '일상', label: '일상' },JSON.parse(options.body).kind||'post') });
    if (requestPath === '/api/posts') {const kind=new URL(path,'http://fixture.invalid').searchParams.get('kind');assert.ok(['all','post','page','notice'].includes(kind),'List kind must follow the actual API contract');return Response.json({ posts: await store.listForAdmin() });}
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
let settingsTitle = field('managementContent').querySelectorAll('input').find(input=>input['aria-label']==='블로그 이름');
settingsTitle.value = '합성 블로그 이름'; settingsTitle.oninput();
await field('closeManagement').onclick();await field('manageCategories').onclick();
await field('closeManagement').onclick();await field('manageSettings').onclick();
assert.equal(field('managementContent').querySelectorAll('input').find(input=>input['aria-label']==='블로그 이름').value,settingsTitle.value);
assert.equal(runInContext('hasManagementChanges()',context),true);
failure = 500;
await field('saveManagement').onclick();
assert.match(field('managementError').textContent, /합성 오류/u);
assert.equal(field('managementContent').querySelectorAll('input').find(input=>input['aria-label']==='블로그 이름').value, '합성 블로그 이름');
assert.notEqual((await configuration.settings()).value.title, '합성 블로그 이름');
await field('saveManagement').onclick();
assert.equal((await configuration.settings()).value.title, '합성 블로그 이름');
settingsTitle = field('managementContent').querySelectorAll('input').find(input=>input['aria-label']==='블로그 이름');
settingsTitle.value = '이 화면의 설정'; settingsTitle.oninput();
const remoteSettings = await configuration.settings();
await configuration.saveSettings(remoteSettings.revision, { ...remoteSettings.value, title: '다른 화면의 설정' });
await field('saveManagement').onclick();
assert.match(field('managementError').textContent, /다른 곳/u);
assert.equal(field('managementContent').querySelectorAll('input').find(input=>input['aria-label']==='블로그 이름').value, '이 화면의 설정');
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
// A real selected image exposes the shortcut; selection itself never edits HTML or saves.
const selectedPhoto=Object.assign(new Element(),{tag:'img',tagName:'IMG',src:'/media/native/123e4567-e89b-42d3-a456-426614174012.png',alt:'선택 사진 설명',closest(){return null},getAttribute(name){return this[name]}});
field('bodyHtml').append(selectedPhoto);
context.selectedPhoto=selectedPhoto;
const unchangedBody=field('bodyHtml').innerHTML;
const selectionRequests=requests.length;
runInContext('selectMedia(selectedPhoto)',context);
assert.equal(field('setSelectedCover').hidden,false);
assert.equal(requests.length,selectionRequests);
await field('setSelectedCover').onclick();
assert.equal(field('bodyHtml').innerHTML,unchangedBody);
assert.equal(runInContext('current.coverPath',context),selectedPhoto.src);
assert.equal(runInContext('current.coverAlt',context),'선택 사진 설명');
await flush();
assert.equal((await store.getForAdmin(activePost.id)).coverMediaId,'123e4567-e89b-42d3-a456-426614174012');
assert.equal((await store.listPublished()).length,1);
const ownedCover=runInContext('current.coverPath',context);
for(const rejected of ['https://outside.test'+selectedPhoto.src,'/media/native/123e4567-e89b-42d3-a456-426614174099.png']){
 selectedPhoto.src=rejected;
 await field('setSelectedCover').onclick();
 assert.equal(runInContext('current.coverPath',context),ownedCover);
}
selectedPhoto.src=ownedCover;
selectedPhoto.alt='로그인 복구 후 설명';
failure=401;
await field('setSelectedCover').onclick();
assert.equal(field('resumeLogin').hidden,false);
assert.equal(field('bodyHtml').innerHTML,unchangedBody);
await field('resumeLogin').onclick();
await flush();
assert.equal((await store.getForAdmin(activePost.id)).coverAlt,'로그인 복구 후 설명');
const card=Object.assign(new Element(),{closest(){return this}});context.syntheticCard=card;
runInContext('selectMedia(syntheticCard)',context);
assert.equal(field('setSelectedCover').hidden,true);
runInContext('clearMediaSelection()',context);
assert.equal(field('setSelectedCover').hidden,true);
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

// Newly added management controls use the same emitted UI against synthetic stores.
await field('manageSettings').onclick();
let timeZoneField=field('managementContent').querySelectorAll('input').find(input=>input['aria-label']==='날짜 표시 시간대');
timeZoneField.value='America/New_York';timeZoneField.oninput();
const licenseField=field('managementContent').querySelectorAll('select').find(select=>select['aria-label']==='저작물 이용허락');
licenseField.value='by-nc-sa';licenseField.onchange();await field('saveManagement').onclick();
assert.equal((await configuration.settings()).value.timezone,'America/New_York');
assert.equal((await configuration.settings()).value.ccl,'by-nc-sa');
await field('closeManagement').onclick();await field('manageTemplates').onclick();
field('managementContent').querySelectorAll('button').find(button=>button.textContent==='빈 서식 추가').onclick();
const templateName=field('managementContent').querySelectorAll('input')[0];templateName.value='합성 회의록';templateName.oninput();
let templateBody=field('managementContent').querySelectorAll('textarea')[0];templateBody.value='<p>합성 서식</p><table><tbody><tr><td>항목</td></tr></tbody></table>';templateBody.oninput();
await field('saveManagement').onclick();assert.equal((await configuration.templates()).value[0].name,'합성 회의록');
templateBody=field('managementContent').querySelectorAll('textarea')[0];templateBody.value='<p>유지할 입력</p><img src="/media/native/synthetic.png">';templateBody.oninput();
const beforeTemplateReject=requests.length;await field('saveManagement').onclick();assert.equal(requests.length,beforeTemplateReject);assert.match(field('managementError').textContent,/사진/u);assert.match(templateBody.value,/유지할 입력/u);
await field('closeManagement').onclick();await field('manageSettings').onclick();await field('closeManagement').onclick();await field('manageTemplates').onclick();
assert.match(field('managementContent').querySelectorAll('textarea')[0].value,/유지할 입력/u);
await field('closeManagement').onclick();
field('postKind').value='page';await field('new').onclick();assert.equal(runInContext('current.kind',context),'page');assert.equal(field('contentKind').value,'page');
const emptyPageId=runInContext('current.id',context);assert.equal(field('deleteEmptyDraft').hidden,false);
await field('deleteEmptyDraft').onclick();assert.equal(await store.getForAdmin(emptyPageId),null);assert.equal(field('editorView').hidden,true);
field('postKind').value='notice';await field('new').onclick();edit('합성 공지');field('bodyHtml').innerHTML='<p>합성 공지 본문</p>';field('bodyHtml').emit('input');await flush();
await field('publicationOptions').onclick();field('publicationVisibility').value='private';field('publicationVisibility').onchange();await field('applyPublication').onclick();
assert.equal(runInContext('current.visibility',context),'private');assert.equal(field('publish').textContent,'비공개본 반영');assert.match(field('lastSaved').textContent,/비공개 상태/u);
assert.equal(field('contentKind').disabled,true);
await field('publicationOptions').onclick();field('publicationVisibility').value='scheduled';field('publicationVisibility').onchange();field('scheduledTime').value='2000-01-01T12:00';
const beforePastSchedule=requests.length;await field('applyPublication').onclick();assert.equal(requests.length,beforePastSchedule);assert.match(field('publicationError').textContent,/미래/u);
const future=new Date(Date.now()+86400000);field('scheduledTime').value=new Date(future.getTime()-future.getTimezoneOffset()*60000).toISOString().slice(0,16);await field('applyPublication').onclick();
assert.equal(runInContext('current.visibility',context),'scheduled');assert.equal(field('publish').textContent,'예약본 반영');
await field('publish').onclick();assert.equal(runInContext('current.visibility',context),'scheduled');
await field('publicationOptions').onclick();field('publicationVisibility').value='protected';field('publicationVisibility').onchange();field('protectionPassword').value='synthetic-only-password';await field('applyPublication').onclick();
assert.equal(runInContext('current.visibility',context),'protected');assert.equal(field('protectionPassword').value,'');
await field('publicationOptions').onclick();assert.equal(field('protectionPassword').value,'');await field('applyPublication').onclick();assert.equal(runInContext('current.visibility',context),'protected');

// Statistics are read-only: opening or failing must not flush/block the editor.
edit('통계를 여는 동안 유지할 미저장 제목');
const beforeStatistics=requests.length;
await field('manageStatistics').onclick();
assert.deepEqual(requests.slice(beforeStatistics).map(request=>request.method),['GET']);
assert.equal(field('title').value,'통계를 여는 동안 유지할 미저장 제목');
assert.equal(runInContext('dirty',context),true);assert.equal(runInContext('blocked',context),null);
assert.equal(field('statisticsDialog').open,true);assert.equal(field('statisticsReport').hidden,false);
assert.equal(field('statisticsToday').textContent,'3');assert.equal(field('statisticsRecent').textContent,'7');assert.equal(field('statisticsTotal').textContent,'10');
assert.match(field('statisticsPeriod').textContent,/2026-08-11 ~ 2026-09-09/u);assert.match(field('statisticsPeriod').textContent,/Asia\/Seoul/u);
assert.equal(field('statisticsChart').children.length,30);assert.equal(field('statisticsDailyRows').children.length,30);
assert.equal(field('statisticsPostRows').children.length,20);assert.equal(field('statisticsPage').textContent,'1 / 2');
await field('statisticsNext').onclick();assert.equal(field('statisticsPostRows').children.length,5);assert.equal(field('statisticsNext').disabled,true);
field('statisticsSearch').value='조회수 없는';field('statisticsSearch').oninput();assert.equal(field('statisticsPostRows').children.length,1);assert.equal(field('statisticsPostRows').children[0].children[1].textContent,'0');assert.equal(field('statisticsPostRows').children[0].children[2].textContent,'0');
field('statisticsSearch').value='';field('statisticsSearch').oninput();field('statisticsSort').value='title';field('statisticsSort').onchange();assert.equal(field('statisticsPostRows').children[0].children[0].textContent,'가나다 조회수 없는 합성 글');
failure=401;await field('refreshStatistics').onclick();assert.equal(field('statisticsLogin').hidden,false);assert.equal(field('statisticsTotal').textContent,'10');assert.match(field('statisticsState').textContent,/가져온 결과/u);assert.equal(runInContext('blocked',context),null);assert.equal(field('title').value,'통계를 여는 동안 유지할 미저장 제목');
await field('refreshStatistics').onclick();assert.equal(field('statisticsLogin').hidden,true);assert.equal(field('statisticsError').textContent,'');
statisticsResponse={...statisticsFixture,timezone:'invalid-zone'};await field('refreshStatistics').onclick();assert.match(field('statisticsError').textContent,/시간대/u);assert.equal(field('statisticsTotal').textContent,'10');statisticsResponse=statisticsFixture;
statisticsResponse={...statisticsFixture,todayViews:0,totalViews:0,periodViews:0,daily:statisticsFixture.daily.map(row=>({...row,views:0})),posts:statisticsFixture.posts.map(row=>({...row,views:0,totalViews:0}))};await field('refreshStatistics').onclick();assert.equal(field('statisticsToday').textContent,'0');assert.equal(field('statisticsTotal').textContent,'0');assert.equal(field('statisticsRecent').textContent,'0');assert.ok(field('statisticsChart').children.every(bar=>bar.dataset.zero==='true'));statisticsResponse=statisticsFixture;
await field('closeStatistics').onclick();assert.equal(field('statisticsDialog').open,false);assert.equal(field('manageStatistics').focused,true);
assert.equal(runInContext('dirty',context),true);

// Public-side deep links select only an exact existing post and never create one.
runInContext('managementDirty=false;managementDrafts.clear()',context);await flush();
let navigationStart=requests.length;window.location.hash='#view=new';await runInContext('followAdminDeepLink()',context);
assert.equal(field('postsPanel').hidden,false);assert.equal(field('new').focused,true);assert.match(field('adminLinkMessage').textContent,/아직 초안은 만들지/u);assert.equal(requests.length,navigationStart);
window.location.hash='#edit='+encodeURIComponent('/posts/597');await runInContext('followAdminDeepLink()',context);
assert.equal(runInContext('current.id',context),draft.id);assert.equal(field('editorView').hidden,false);assert.deepEqual(requests.slice(navigationStart).map(request=>request.method),['GET']);
edit('직접 연결에도 유지할 내용');navigationStart=requests.length;
window.location.hash='#edit=/posts/598';await runInContext('followAdminDeepLink()',context);assert.equal(field('title').value,'직접 연결에도 유지할 내용');assert.equal(runInContext('current.id',context),draft.id);assert.equal(requests.length,navigationStart);assert.equal(field('openAdminLinkTab').hidden,false);assert.equal(field('openAdminLinkTab').href,'/#edit=/posts/598');
window.location.hash='#edit=/posts/597';await runInContext('followAdminDeepLink()',context);assert.equal(field('title').value,'직접 연결에도 유지할 내용');assert.equal(requests.length,navigationStart);assert.equal(field('editorView').hidden,false);
window.location.hash='#view=statistics';await runInContext('followAdminDeepLink()',context);assert.equal(field('statisticsDialog').open,true);assert.equal(field('title').value,'직접 연결에도 유지할 내용');assert.deepEqual(requests.slice(navigationStart).map(request=>request.method),['GET']);await field('closeStatistics').onclick();
window.location.hash='#view=settings';navigationStart=requests.length;await runInContext('followAdminDeepLink()',context);assert.equal(field('managementDialog').open,true);assert.equal(field('title').value,'직접 연결에도 유지할 내용');assert.ok(requests.slice(navigationStart).every(request=>request.method==='GET'));await field('closeManagement').onclick();
// Clear only synthetic unsaved management input, then explicitly save the synthetic post.
runInContext('managementDirty=false;managementDrafts.clear()',context);await flush();
window.location.hash='#edit=/posts/999999';navigationStart=requests.length;await runInContext('followAdminDeepLink()',context);assert.match(field('adminLinkMessage').textContent,/찾지 못했습니다/u);assert.equal(runInContext('current.id',context),draft.id);assert.deepEqual(requests.slice(navigationStart).map(request=>request.method),['GET']);
window.location.hash='#edit=https://other.invalid/post';navigationStart=requests.length;await runInContext('followAdminDeepLink()',context);assert.match(field('adminLinkMessage').textContent,/올바르지/u);assert.equal(requests.length,navigationStart);
window.location.hash='#edit=/posts/597&view=new';await runInContext('followAdminDeepLink()',context);assert.equal(requests.length,navigationStart);
// Authentication failure keeps the hash and currently open editor; retry resolves it.
const pageDraft=await store.createDraft({id:'daily',slug:'일상',label:'일상'},'page');const pageWorking=await store.update(pageDraft.id,0,{...input,title:'합성 직접 연결 페이지'});const pagePublic=await store.publish(pageDraft.id,pageWorking.revision);
window.location.hash='#edit='+encodeURIComponent(pagePublic.publicPath);failure=401;await runInContext('followAdminDeepLink()',context);assert.equal(field('openAdminLinkTab').hidden,false);assert.equal(field('retryAdminLink').hidden,false);assert.equal(runInContext('current.id',context),draft.id);navigationStart=requests.length;
await field('retryAdminLink').onclick();assert.equal(runInContext('current.id',context),pageDraft.id);assert.equal(field('adminLinkNotice').hidden,true);assert.deepEqual(requests.slice(navigationStart).map(request=>request.method),['GET']);
assert.equal(window.location.hash,'#edit='+encodeURIComponent(pagePublic.publicPath));

console.log(JSON.stringify({ suite: 'editor-ui-state', status: 'PASS', behavior: 'actual emitted UI, preserved list/editor navigation, preview dialog and focus, autosave isolation, failure retry, login continuation, conflict choices, in-flight edit, flush-before-publish, edit lock and new post' }));
