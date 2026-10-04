import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { load } from 'cheerio';
import { mountPublicNavigation } from '../src/lib/public-admin-links.ts';

const [siteHeader, adminComponent, baseLayout] = await Promise.all([
  'src/components/SiteHeader.astro', 'src/components/AdminQuickLinks.astro', 'src/layouts/BaseLayout.astro',
].map(path => readFile(new URL('../' + path, import.meta.url), 'utf8')));
const markup = siteHeader.slice(siteHeader.indexOf('<header')).split('<CategoryDrawer')[0]
  .replace('<AdminQuickLinks />', adminComponent.split('<script>')[0]);
const $ = load(markup + '<main><button id="outside">본문</button></main><dialog><button id="dialog-close">닫기</button></dialog>');
assert.equal($('.site-header [data-public-admin-tools]').length, 1, 'One authenticated disclosure belongs to the header row');
assert.equal($('[data-public-admin-tools] a').length, 4, 'All management destinations remain available');
assert.equal($('[data-public-admin-tools] a[target="_blank"][rel="noopener noreferrer"][aria-label$="(새 탭)"]').length, 4);
assert.equal($('[data-public-admin-tools][hidden]').length, 1, 'Server HTML does not expose authenticated tools');
assert.equal($('[data-category-open]').length, 1);
assert.equal($('[data-search-open]').length, 1);
assert.equal($('[data-site-menu-toggle]').attr('aria-controls'), $('.site-nav').attr('id'));
assert.equal(baseLayout.includes('<AdminQuickLinks'), false, 'The separate management row has been removed');
assert.match(baseLayout, /import '\.\.\/styles\/global\.css';\s*import '\.\.\/styles\/photo-info\.css';/u);

const listeners = new Map(), wrappers = new WeakMap(), frames = [];
const listen = (owner, name, callback) => {
  if (!listeners.has(owner)) listeners.set(owner, new Map());
  const events = listeners.get(owner); if (!events.has(name)) events.set(name, []);
  events.get(name).push(callback);
};
const fire = (owner, name, event = {}) => { for (const callback of listeners.get(owner)?.get(name) ?? []) callback(event); };
const flushFrames = () => { while (frames.length) frames.shift()(); };
class Element {
  constructor(node) { this.node = node; }
  querySelector(selector) { return wrap($(this.node).find(selector)[0]); }
  closest(selector) { return wrap($(this.node).closest(selector)[0]); }
  contains(other) { return other === this || $(other.node).parents().toArray().includes(this.node); }
  getAttribute(name) { return $(this.node).attr(name) ?? null; }
  setAttribute(name, value) { $(this.node).attr(name, value); }
  removeAttribute(name) { $(this.node).removeAttr(name); }
  get open() { return this.getAttribute('open') !== null; }
  get hidden() { return this.getAttribute('hidden') !== null; }
  set hidden(value) { value ? this.setAttribute('hidden', '') : this.removeAttribute('hidden'); }
  addEventListener(name, callback) { listen(this, name, callback); }
  focus() { document.activeElement = this; }
}
function wrap(node) { if (!node) return null; if (!wrappers.has(node)) wrappers.set(node, new Element(node)); return wrappers.get(node); }
const header = wrap($('.site-header')[0]), toggle = wrap($('[data-site-menu-toggle]')[0]);
const navigation = wrap($('.site-nav')[0]), admin = wrap($('[data-public-admin-tools]')[0]);
const summary = admin.querySelector('summary'), outside = wrap($('#outside')[0]), dialogClose = wrap($('#dialog-close')[0]);
const saved = Object.fromEntries(['document', 'window', 'Element', 'requestAnimationFrame'].map(name => [name, globalThis[name]]));
try {
  const narrow = { matches: true, addEventListener(name, callback) { listen(this, name, callback); } };
  globalThis.Element = Element;
  globalThis.document = { activeElement: outside, querySelector: selector => wrap($(selector)[0]), addEventListener(name, callback) { listen(this, name, callback); } };
  globalThis.window = { matchMedia(query) { assert.equal(query, '(max-width: 900px)'); return narrow; } };
  globalThis.requestAnimationFrame = callback => { frames.push(callback); return frames.length; };
  mountPublicNavigation();
  assert.equal(toggle.hidden, false);
  assert.equal(header.getAttribute('data-site-menu-ready'), '');
  const openMenu = () => { toggle.focus(); fire(toggle, 'click'); assert.equal(toggle.getAttribute('aria-expanded'), 'true'); assert.equal(header.getAttribute('data-site-menu-open'), ''); };
  const assertClosed = () => { assert.equal(toggle.getAttribute('aria-expanded'), 'false'); assert.equal(header.getAttribute('data-site-menu-open'), null); };
  const escape = (extra = {}) => { const event = { key: 'Escape', prevented: false, preventDefault() { this.prevented = true; }, ...extra }; fire(header, 'keydown', event); return event; };
  assertClosed(); openMenu();
  for (const extra of [{isComposing:true}, {keyCode:229}]) { assert.equal(escape(extra).prevented, false); assert.equal(toggle.getAttribute('aria-expanded'), 'true'); }
  assert.equal(escape().prevented, true); assertClosed(); assert.equal(document.activeElement, toggle);
  openMenu(); fire(toggle, 'click'); assertClosed();
  openMenu(); fire(document, 'pointerdown', {target:dialogClose}); assert.equal(toggle.getAttribute('aria-expanded'), 'true', 'A dialog keeps the menu opener available');
  dialogClose.focus(); fire(header, 'focusout'); flushFrames(); assert.equal(toggle.getAttribute('aria-expanded'), 'true');
  navigation.querySelector('[data-category-open]').focus(); fire(header, 'focusout'); flushFrames(); assert.equal(toggle.getAttribute('aria-expanded'), 'true');
  outside.focus(); fire(header, 'focusout'); flushFrames(); assertClosed();
  openMenu(); fire(document, 'pointerdown', {target:outside}); assertClosed();
  openMenu(); fire(summary, 'click'); assertClosed();
  admin.setAttribute('open', ''); admin.querySelector('a').focus(); assert.equal(escape().prevented, true); assert.equal(admin.open, false); assert.equal(document.activeElement, summary);
  admin.setAttribute('open', ''); openMenu(); assert.equal(admin.open, false, 'Opening the main menu closes the management menu');
  narrow.matches = false; fire(narrow, 'change'); assertClosed();
  assert.equal(escape().prevented, false, 'The wide navigation does not consume unrelated Escape keys');
  admin.setAttribute('open', ''); fire(document, 'pointerdown', {target:outside}); assert.equal(admin.open, false);
  console.log(JSON.stringify({suite:'public-navigation', status:'PASS', behavior:'single header row, preserved category/search/admin destinations, menu and management disclosures, Escape/focus return, IME guard, modal opener remains visible, outside click/tab and breakpoint dismissal'}));
} finally { for (const [name, value] of Object.entries(saved)) value === undefined ? delete globalThis[name] : globalThis[name] = value; }
