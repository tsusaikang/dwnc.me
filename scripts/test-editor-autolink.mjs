import assert from 'node:assert/strict';
import vm from 'node:vm';
import { autoLinkScript } from '../src/lib/admin-autolink.ts';
import { sanitizeNativeHtml, sanitizeLegacyHtml } from '../src/lib/native-content.ts';
import { NativePostStore } from '../src/lib/native-post-store.ts';
import { createEditorDatabase } from './fixtures/editor-database.mjs';

// Exercise detection and actual input-event provenance with small text nodes.
// Range extraction, caret placement and undo are also checked in the browser
// fixture; this adapter deliberately does not pretend to implement browser DOM.
const handlers = new Map();
const root = { nodeType: 1, tagName: 'DIV', childNodes: [], addEventListener(type, listener) { const all = handlers.get(type) ?? []; all.push(listener); handlers.set(type, all); }, querySelectorAll() { return []; } };
function textNode(data, excluded = false) { return { nodeType: 3, data, parentElement: { closest() { return excluded ? {} : null; } } }; }
let node = textNode(''), caret = 0, selectionEnd = 0;
root.childNodes = [node];
const context = vm.createContext({ URL, Map, Set, console, $: () => root, bodyRange: () => ({ startContainer: node, startOffset: caret, endContainer: node, endOffset: selectionEnd, collapsed: caret === selectionEnd }) });
vm.runInContext('let busy=false,current={id:"synthetic"},editorTyping=null;', context);
vm.runInContext(autoLinkScript, context);
const run = source => vm.runInContext(source, context);
const plain = value => JSON.parse(JSON.stringify(value));
const matches = value => { context.testText = value; return plain(run('autoLinkMatches(testText)')); };
assert.deepEqual(matches('https://example.test/a?x=1&y=2').map(item => item.href), ['https://example.test/a?x=1&y=2']);
assert.deepEqual(matches('(https://example.test/a_(b)). https://example.test/x, www.example.test!').map(item => item.label), ['https://example.test/a_(b)', 'https://example.test/x', 'www.example.test']);
assert.equal(matches('www.example.test')[0].href, 'https://www.example.test');
assert.equal(matches('https://example.test/경로')[0].label, 'https://example.test/경로');
assert.equal(matches('참고 (https://example.test/path)을 봐주세요 ')[0].label, 'https://example.test/path');
assert.equal(matches('https://example.test을').length, 0, 'Do not turn Korean particles into a different hostname');
for (const value of ['file.js', 'example.com', 'https://', 'javascript:alert(1)', 'mailto:a@example.test', 'https://user:pass@example.test', 'a@www.example.test']) assert.equal(matches(value).length, 0, value);

run('let offered=[];autoLinkApply=()=>{const snapshot=autoLinkSnapshot();offered.push(...autoLinkMatches(snapshot.text).filter(match=>autoLinkAllowed(snapshot,match)))};autoLinkReleaseSpace=()=>{};');
function event(type, detail = {}) { for (const listener of handlers.get(type) ?? []) listener({ ...detail }); }
function reset(text = '', excluded = false) { node = textNode(text, excluded); root.childNodes = [node]; caret = selectionEnd = text.length; run('resetAutoLinks();offered=[]'); }
function insert(text, type = 'insertText', isComposing = false) {
  event('beforeinput', { inputType: type, data: text, isComposing });
  node.data = node.data.slice(0, caret) + text + node.data.slice(selectionEnd); caret += text.length; selectionEnd = caret;
  event('input', { inputType: type, data: text, isComposing });
}
function offered() { return plain(run('offered')); }
const url = 'https://example.test/article';
reset(url); insert(' '); assert.equal(offered().length, 0, 'Old bare URL plus space must stay untouched');
reset(url); insert('\n', 'insertParagraph'); assert.equal(offered().length, 0, 'Old bare URL plus Enter must stay untouched');
reset(url); insert('/new'); insert(' '); assert.equal(offered().length, 0, 'Editing the suffix of an old URL is not a new URL');
reset(); for (const character of url) insert(character); assert.equal(offered().length, 0); insert(' '); assert.equal(offered()[0].href, url);
reset(); for (const character of url) insert(character); insert('\n', 'insertParagraph'); assert.equal(offered()[0].href, url);
reset(); insert(url, 'insertFromPaste'); assert.equal(offered()[0].href, url, 'Plain URL paste is complete without a delimiter');
reset('old text');
event('paste', { clipboardData: { files: [], getData: type => type === 'text/plain' ? url : '' } });
node.data = 'old text\n' + url; caret = selectionEnd = node.data.length;
event('input', { inputType: 'insertFromPaste' });
assert.equal(offered()[0].start, 'old text\n'.length, 'Clipboard provenance survives native empty-block normalization and missing beforeinput');
reset(); insert(url + ', www.example.test.', 'insertFromPaste'); assert.equal(offered().length, 2);
reset(url); caret = selectionEnd = 0; insert(url + ' ', 'insertFromPaste'); assert.deepEqual(offered().map(item => item.start), [0], 'Repeated text must link only the pasted copy, not the old copy');
reset('', true); insert(url, 'insertFromPaste'); assert.equal(offered().length, 0, 'Anchors, code, no-link spans and noneditable content are excluded');
reset(); event('compositionstart'); insert(url, 'insertCompositionText', true); assert.equal(offered().length, 0); event('compositionend'); insert(' '); assert.equal(offered()[0].href, url, 'Composition completes before conversion');
reset(); insert(url + '/'); event('compositionstart'); insert('ㅎ', 'insertCompositionText', true);
event('beforeinput', { inputType: 'insertCompositionText', data: '한', isComposing: true });
node.data = url + '/한'; caret = selectionEnd = node.data.length; event('input', { inputType: 'insertCompositionText', data: '한', isComposing: true });
event('compositionend'); insert(' '); assert.equal(offered()[0].href, url + '/한', 'IME replacement retains the newly typed URL prefix');
reset(); insert(url); run('resetAutoLinks()'); insert(' '); assert.equal(offered().length, 0, 'Reopen/undo resets new-input provenance');
reset(); insert('123'); node.data = url; caret = selectionEnd = node.data.length; insert(' '); assert.equal(offered().length, 0, 'External formatting or template changes cannot reuse stale provenance');

// Block separators prevent a URL from accidentally absorbing the next paragraph.
const a = textNode(url), b = textNode('next');
root.childNodes = [{ nodeType: 1, tagName: 'P', childNodes: [a] }, { nodeType: 1, tagName: 'P', childNodes: [b] }];
assert.equal(run('autoLinkSnapshot().text'), url + '\nnext\n');
root.childNodes = [a, b];
context.boundary = url.length;
assert.equal(run('autoLinkPoint(autoLinkSnapshot(),boundary)[0]'), b, 'A new URL starts outside the preceding text/anchor/formatting node');
assert.equal(run('autoLinkPoint(autoLinkSnapshot(),boundary,true)[0]'), a, 'A URL end stays in its final text node');

// Reapplying and removing a manual link reuses its existing intent marker.
let replacement = null, selectedMarker = null;
const marker = { matches: selector => selector === 'span[data-dwnc-no-autolink]' }, child = {};
context.testLink = { parentElement: marker, childNodes: [child], replaceWith(...children) { replacement = children; } };
root.contains = () => true;
Object.assign(context, { restoreFormatRange() {}, captureEditorBefore() {}, captureFormatRange() {}, schedule() {}, document: { createElement() { throw new Error('Do not nest intent spans'); }, createRange: () => ({ selectNodeContents(value) { selectedMarker = value; } }) }, window: { getSelection: () => ({ removeAllRanges() {}, addRange() {} }) } });
run('removeEditorLink(testLink)');
assert.deepEqual(replacement, [child]); assert.equal(selectedMarker, marker);

const marked = '<p><span data-dwnc-no-autolink="true">'+url+'</span></p>';
for (const sanitize of [sanitizeNativeHtml, sanitizeLegacyHtml]) { assert.equal(sanitize(marked), marked); assert.equal(sanitize('<p>'+url+'</p>'), '<p>'+url+'</p>'); }
assert.ok(!sanitizeNativeHtml('<p data-dwnc-no-autolink="true">text</p>').includes('data-dwnc-no-autolink'), 'New marker allowance is confined to spans');
const database = await createEditorDatabase(), store = new NativePostStore(database);
let draft = await store.createDraft({ id: 'daily', slug: '일상', label: '일상' });
draft = await store.update(draft.id, draft.revision, { title: '합성 링크 해제 보존', description: '', bodyFormat: 'html', bodyMarkdown: marked, categoryId: 'daily', tags: [], coverMediaId: null });
assert.equal((await store.getForAdmin(draft.id)).bodyHtml, marked);
const published = await store.publish(draft.id, draft.revision);
assert.equal((await store.getPublishedBySequence(published.globalSequence)).bodyHtml, marked);
database.sqlite.close();
console.log('PASS editor autolink: fresh input only, delimiters/paste/composition, exclusions, old-content preservation, persistent unlink, store roundtrip');
