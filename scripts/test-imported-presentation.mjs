import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Script } from 'node:vm';
import { pathToFileURL } from 'node:url';
import { load } from 'cheerio';
import { createSatteriMarkdownProcessor } from '@astrojs/markdown-satteri';
import corrections from '../src/data/imported-formatting-corrections.json' with { type: 'json' };
import sequence from '../src/data/public-sequence-v1.json' with { type: 'json' };
import { prepareImportedPresentation, ENGINE_DIAGRAM_BOOTSTRAP } from '../src/lib/imported-presentation.ts';
import { ENGINE_DIAGRAM_BASELINE, ENGINE_STATIC_BASELINE } from '../src/lib/engine-diagram-content.ts';
import { sanitizeLegacyHtml } from '../src/lib/native-content.ts';
import { createEditorDatabase, seedLegacy } from './fixtures/editor-database.mjs';
import { createNativePublicWorker } from '../src/lib/native-public-worker.ts';
import { mountEngineDiagram } from '../src/lib/engine-diagram-client.js';

const text = (html) => load(html, null, false).text().replace(/\s+/g, ' ').trim();
const links = (html) => { const $ = load(html, null, false); return $('[href],[src]').map((_, node) => [$(node).attr('href') ?? $(node).attr('src')]).get(); };
const body = async (source, id) => {
  const value = await readFile(new URL(`../src/data/posts/${source}/${id}.md`, import.meta.url), 'utf8');
  return value.slice(value.indexOf('\n---\n', 4) + 5);
};

for (const entry of corrections) {
  assert(sequence.some((post) => post.source === entry.source && post.sourceId === entry.sourceId));
  for (const correction of entry.corrections) {
    assert.equal(text(correction.replacement), text(correction.expected));
    assert.deepEqual(links(correction.replacement), links(correction.expected));
    assert.equal(load(correction.replacement)('script,iframe[src^="javascript:"],[onclick]').length, 0);
    const displayed = prepareImportedPresentation(correction.expected, entry);
    assert.equal(displayed, correction.replacement);
    assert.equal(prepareImportedPresentation(displayed, entry), displayed);
    const edited = correction.expected.replace('>', ' data-user-edited="true">');
    const editedDisplay = prepareImportedPresentation(edited, entry);
    assert(editedDisplay.includes('data-user-edited="true"'));
    assert.equal(text(editedDisplay), text(edited));
    const changed = correction.expected.replace(/>([^<]+)</, '>현재 작성자가 바꾼 문장<');
    assert.equal(text(prepareImportedPresentation(changed, entry)), text(changed));
  }
  const original = await body(entry.source, entry.sourceId);
  const displayed = prepareImportedPresentation(original, entry);
  assert.equal(text(displayed), text(original));
  assert.deepEqual(links(displayed), links(original));
}

const input = await body('tistory', '165');
const identity = { source: 'tistory', sourceId: '165' };
const processor = await createSatteriMarkdownProcessor({
  syntaxHighlight: { type: 'shiki', excludeLangs: ['math'] },
  shikiConfig: { theme: 'github-dark-default', wrap: true }, smartypants: true,
});
const rendered = (await processor.render(input)).code;
const restored = prepareImportedPresentation(rendered, identity);
const $ = load(restored);
assert.equal($('[data-engine-diagram]').length, 1);
assert.equal($('canvas').length, 1);
assert.equal($('svg').length, 1);
assert.equal($('[data-engine-diagram] button').length, 9);
assert.equal($('input[type="range"]').length, 1);
assert.equal($('script').length, 0);
assert.equal(prepareImportedPresentation(restored, identity), restored);
assert.equal(prepareImportedPresentation(ENGINE_DIAGRAM_BASELINE), ENGINE_DIAGRAM_BASELINE);
assert.equal(prepareImportedPresentation(ENGINE_STATIC_BASELINE, { source: 'tistory', sourceId: '172' }), ENGINE_STATIC_BASELINE);
const modified = ENGINE_DIAGRAM_BASELINE.replace('v6x-lead', 'v6x-lead user-edited');
assert.equal(prepareImportedPresentation(modified, identity), modified);
// The live database contains the Markdown-rendered HTML after the import
// sanitizer normalized style spacing. Test the real import-to-display pipeline.
const imported = sanitizeLegacyHtml(rendered);
const importedRestored = prepareImportedPresentation(imported, identity);
const importedDom = load(importedRestored);
assert.equal(importedDom('[data-engine-diagram]').length, 1);
assert.equal(importedDom('[data-engine-diagram] button').length, 9);
assert.equal(importedDom('canvas').length, 1);
assert.equal(importedDom('svg').length, 1);
assert.equal(prepareImportedPresentation(importedRestored, identity), importedRestored);
// Known malformed rendered wrappers contain the original closing summary. It
// must remain outside the repaired component instead of being removed with it.
for (const output of [restored, importedRestored]) {
  const displayed = load(output);
  for (const node of load(rendered)('#v6crank3d > .v6x-wrap').nextAll().toArray()) {
    assert(text(output).includes(text(load(node).html())));
  }
  assert.equal(displayed('[data-engine-diagram]').nextAll('h3').first().text(), '정리');
}
const editedImported = imported.replace('알고 나니 엔진 소리가 조금 다르게 들리는 것 같다.', '작성자가 바꾼 마지막 문장');
const preservedEdited = prepareImportedPresentation(editedImported, identity);
assert(preservedEdited.includes('작성자가 바꾼 마지막 문장'));
assert.equal(load(preservedEdited)('[data-engine-diagram]').length, 0);
assert.equal(load(prepareImportedPresentation(imported, {source:'tistory',sourceId:'172'}))('[data-engine-diagram]').length, 0);
new Script(ENGINE_DIAGRAM_BOOTSTRAP);

// The committed renderer contains only the one reviewed, local drawing component.
const client = await readFile(new URL('../src/lib/engine-diagram-client.js', import.meta.url), 'utf8');
assert(!/\b(?:fetch|XMLHttpRequest|WebSocket|eval|localStorage|sessionStorage)\s*\(/u.test(client));
const browserFunctionSource=client.slice(client.indexOf('export function mountEngineDiagram')).replace('export function','function').trim();
assert.equal(ENGINE_DIAGRAM_BOOTSTRAP,`(${browserFunctionSource})(document.querySelector('[data-engine-diagram]'));`);

// Execute the actual component's mode/view/play/speed and lifecycle actions.
// Canvas pixels and responsive layout are checked in the browser.
const dom = load(restored, null, false), wrappers = new WeakMap(), frames = new Map();
let nextFrame = 0, draws = 0;
const gradient = { addColorStop() {} };
const context = new Proxy({}, { get: (_, name) => name === 'clearRect' ? () => { draws++; } : name.startsWith('create') ? () => gradient : () => {} });
const wrap = (node) => {
  if (!node) return null;
  if (wrappers.has(node)) return wrappers.get(node);
  const events = {};
  const element = {
    dataset: { ...Object.fromEntries(Object.entries(node.attribs ?? {}).filter(([key]) => key.startsWith('data-')).map(([key, value]) => [key.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase()), value])) },
    style: {}, isConnected: true, clientWidth: 700, clientHeight: 360, hidden: false,
    get value() { return dom(node).attr('value'); }, set value(value) { dom(node).attr('value', value); },
    get innerHTML() { return dom(node).html(); }, set innerHTML(value) { dom(node).html(value); },
    get textContent() { return dom(node).text(); }, set textContent(value) { dom(node).text(value); },
    get className() { return dom(node).attr('class'); }, set className(value) { dom(node).attr('class', value); },
    querySelector(selector) { return wrap(dom(node).find(selector)[0]); },
    querySelectorAll(selector) { return dom(node).find(selector).toArray().map(wrap); },
    appendChild(child) { dom(node).append(child.node); }, node,
    setAttribute(name, value) { dom(node).attr(name, value); },
    addEventListener(type, callback) { (events[type] ??= []).push(callback); },
    emit(type) { for (const callback of events[type] ?? []) callback({ target: element, clientX: 10, clientY: 10 }); },
    getContext() { return context; }, getClientRects() { return element.hidden ? [] : [{}]; },
    classList: { add(name) { dom(node).addClass(name); }, remove(name) { dom(node).removeClass(name); }, toggle(name, value) { dom(node).toggleClass(name, value); } },
  };
  wrappers.set(node, element); return element;
};
const previous = Object.fromEntries(['window', 'document', 'requestAnimationFrame', 'cancelAnimationFrame'].map((key) => [key, globalThis[key]]));
try {
  globalThis.window = { devicePixelRatio: 1, addEventListener() {}, matchMedia: () => ({ matches: false }) };
  globalThis.document = { createElement: (tag) => wrap(dom(`<${tag}></${tag}>`)[0]), createElementNS: (_, tag) => wrap(dom(`<${tag}></${tag}>`)[0]) };
  globalThis.requestAnimationFrame = (callback) => { frames.set(++nextFrame, callback); return nextFrame; };
  globalThis.cancelAnimationFrame = (id) => frames.delete(id);
  const root = wrap(dom('[data-engine-diagram]')[0]);
  const cleanup = mountEngineDiagram(root);
  const runFrame = (time) => { const [id, callback] = frames.entries().next().value; frames.delete(id); callback(time); };
  runFrame(0); assert(draws > 0); assert.equal(dom('.v6x-tl-row').length, 4);
  for (const mode of ['naive', 'real', 'split', 'sixty', 'v8']) {
    root.querySelector(`[data-mode="${mode}"]`).emit('click');
    assert.equal(dom('.v6x-tl-row').length, mode === 'v8' ? 4 : 3);
    assert(dom(`#v6x-caption`).text().length > 20);
  }
  root.querySelector('[data-view="end"]').emit('click');
  assert(dom('[data-view="end"]').hasClass('active'));
  root.querySelector('#v6x-playBtn').emit('click'); runFrame(100);
  assert.equal(dom('#v6x-angleReadout').text(), '0° / 720°');
  root.querySelector('#v6x-speed').value = '2'; root.querySelector('#v6x-speed').emit('input');
  root.querySelector('#v6x-playBtn').emit('click'); runFrame(200);
  assert.equal(dom('#v6x-angleReadout').text(), '18° / 720°');
  const beforeHidden = draws; root.hidden = true; runFrame(300); assert.equal(draws, beforeHidden);
  root.isConnected = false; runFrame(400); assert.equal(frames.size, 0); cleanup();
} finally {
  for (const [key, value] of Object.entries(previous)) value === undefined ? delete globalThis[key] : globalThis[key] = value;
}
// Exercise the actual dynamic Worker with an isolated in-memory copy of the
// public Markdown-to-import output, including the identity and bootstrap wiring.
const database = await createEditorDatabase(); seedLegacy(database);
database.sqlite.prepare("UPDATE legacy_posts SET id='legacy-588', global_sequence=588, source_id='165', body_html=?, body_text=? WHERE id='legacy-1'").run(imported,text(imported));
class PublicRewriter {
  handlers=[];
  on(selector,handler){this.handlers.push([selector,handler]);return this;}
  async transform(response){
    const $=load(await response.text());
    for(const [selector,handler] of this.handlers)$(selector).each((_,node)=>handler.element({
      setInnerContent:(value,options={})=>options.html?$(node).html(value):$(node).text(value),
      setAttribute:(name,value)=>$(node).attr(name,value),remove:()=>$(node).remove(),append:value=>$(node).append(value),
    }));
    return new Response($.html(),{status:response.status,headers:response.headers});
  }
}
const oldRewriter=globalThis.HTMLRewriter;
try {
  globalThis.HTMLRewriter=PublicRewriter;
  const assets=async request=>new URL(request.url).pathname==='/search-index.json'?Response.json([]):new Response('<html><head><title>합성</title></head><body><main id="main"></main></body></html>',{headers:{'content-type':'text/html'}});
  const bundleFlag=process.argv.indexOf('--worker-bundle');
  const worker=bundleFlag>=0?(await import(pathToFileURL(process.argv[bundleFlag+1]).href)).default.fetch:createNativePublicWorker(assets);
  const response=await worker(new Request('https://dwnc.me/posts/588'),{NATIVE_DB:database,ASSETS:{fetch:assets}},{});
  const page=load(await response.text());
  assert.equal(response.status,200);
  assert.equal(page('[data-engine-diagram]').length,1);
  assert.equal(page('[data-engine-diagram] button').length,9);
  assert.equal(page('[data-engine-diagram] canvas').length,1);
  assert(page('script').toArray().some(node=>page(node).text().includes('v6x-playBtn')));
  assert.equal(page('[data-engine-diagram]').nextAll('h3').first().text(),'정리');
  assert(page('.prose').text().includes('알고 나니 엔진 소리가 조금 다르게 들리는 것 같다.'));
  // Execute the inline script actually emitted by the Worker. A fresh browser
  // context has no bundler helpers; the former function.toString() fails here
  // after Wrangler keepNames adds references to its Worker-local __name helper.
  const inline=page('script').toArray().map(node=>page(node).text()).find(script=>script.includes('v6x-playBtn'));
  dom.root().html(page('.prose').html());frames.clear();draws=0;
  const browserContext={
    AbortController,
    window:{devicePixelRatio:1,addEventListener(){},matchMedia:()=>({matches:false})},
    document:{querySelector:selector=>wrap(dom(selector)[0]),createElement:tag=>wrap(dom(`<${tag}></${tag}>`)[0]),createElementNS:(_,tag)=>wrap(dom(`<${tag}></${tag}>`)[0])},
    requestAnimationFrame:callback=>{frames.set(++nextFrame,callback);return nextFrame;},
    cancelAnimationFrame:id=>frames.delete(id),
  };
  new Script(inline).runInNewContext(browserContext);
  const runBrowserFrame=time=>{const [id,callback]=frames.entries().next().value;frames.delete(id);callback(time);};
  runBrowserFrame(0);assert(draws>0);
  const browserRoot=wrap(dom('[data-engine-diagram]')[0]);
  browserRoot.querySelector('[data-mode="split"]').emit('click');assert.equal(dom('.v6x-tl-row').length,3);
  browserRoot.querySelector('[data-view="end"]').emit('click');assert(dom('[data-view="end"]').hasClass('active'));
  runBrowserFrame(100);const visibleAngle=dom('#v6x-angleReadout').text();assert(Number.parseInt(visibleAngle)>0);
  browserRoot.querySelector('#v6x-playBtn').emit('click');runBrowserFrame(200);assert.equal(dom('#v6x-angleReadout').text(),visibleAngle);
  browserRoot.isConnected=false;runBrowserFrame(300);assert.equal(frames.size,0);
  if(bundleFlag>=0)console.log('Compiled Worker emitted diagram script: VM drawing, mode, view, time and pause PASS');

} finally {
  if(oldRewriter===undefined)delete globalThis.HTMLRewriter;else globalThis.HTMLRewriter=oldRewriter;
}
console.log('Imported presentation repairs, unchanged-content isolation, and authored diagram markup PASS');
