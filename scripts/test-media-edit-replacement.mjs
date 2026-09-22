import assert from 'node:assert/strict';
import vm from 'node:vm';
import { load } from 'cheerio';
import { extrasHtml, extrasScript } from '../src/lib/admin-extras.ts';
import { editorHistoryScript } from '../src/lib/admin-editor-history.ts';
import { sanitizeNativeHtml, sanitizeLegacyHtml } from '../src/lib/native-content.ts';
import { NativePostStore } from '../src/lib/native-post-store.ts';
import { createEditorDatabase, seedLegacy } from './fixtures/editor-database.mjs';

// A DOM adapter exercises the real dialog/apply/history code. Browser fixture
// verification covers native selection; insertHTML is deliberately unavailable.
const $=load('<div id="bodyHtml"></div>'+extrasHtml+'<button id="moreTools"></button><select id="fontFamily"></select><button id="editSelectedMedia"></button><div id="uploadPanel"></div>');
const wrappers=new WeakMap();
class Element {
  constructor(node){this.node=node;this.dataset=new Proxy({}, {get:(_,key)=>this.getAttribute('data-'+key.replace(/[A-Z]/g,c=>'-'+c.toLowerCase())),set:(_,key,value)=>{this.setAttribute('data-'+key.replace(/[A-Z]/g,c=>'-'+c.toLowerCase()),value);return true}});const style={getPropertyValue:key=>this.styles()[key]||'',removeProperty:key=>{const values=this.styles();delete values[key];this.writeStyles(values)},setProperty:(key,value)=>this.writeStyles({...this.styles(),[key]:value})};this.style=new Proxy(style,{get:(target,key)=>key in target?target[key]:this.styles()[key.replace(/[A-Z]/g,c=>'-'+c.toLowerCase())]||'',set:(_,key,value)=>{style.setProperty(key.replace(/[A-Z]/g,c=>'-'+c.toLowerCase()),value);return true}});this.classList={add:(...v)=>$(node).addClass(v.join(' ')),remove:(...v)=>$(node).removeClass(v.join(' ')),contains:v=>$(node).hasClass(v)}}
  styles(){return Object.fromEntries((this.getAttribute('style')||'').split(';').filter(v=>v.includes(':')).map(v=>{const i=v.indexOf(':');return[v.slice(0,i).trim(),v.slice(i+1).trim()]}))}
  writeStyles(v){this.setAttribute('style',Object.entries(v).map(([k,v])=>k+':'+v).join(';'))}
  get id(){return this.getAttribute('id')}set id(v){this.setAttribute('id',v)}
  get className(){return this.getAttribute('class')}set className(v){this.setAttribute('class',v)}
  get nodeType(){return this.node.type==='text'?3:this.node.type==='root'?11:1}get tagName(){return this.node.name?.toUpperCase()}
  get textContent(){return $(this.node).text()}set textContent(v){$(this.node).text(v)}
  get innerHTML(){return $(this.node).html()}set innerHTML(v){$(this.node).html(v)}get outerHTML(){return $.html(this.node)}
  get children(){return $(this.node).children().toArray().map(wrap)}get childNodes(){return(this.node.children||[]).map(wrap)}
  get lastChild(){return this.childNodes.at(-1)}get parentNode(){return wrap(this.node.parent)}get parentElement(){return this.parentNode}
  get nextElementSibling(){return wrap($(this.node).next()[0])}get rows(){return this.querySelectorAll('tr')}get cells(){return this.children.filter(n=>n.matches('td,th'))}
  get colSpan(){return Number(this.getAttribute('colspan')||1)}set colSpan(v){this.setAttribute('colspan',v)}get rowSpan(){return Number(this.getAttribute('rowspan')||1)}
  getAttribute(k){return this.node.attribs?.[k]??null}setAttribute(k,v){this.node.attribs[k]=String(v)}removeAttribute(k){delete this.node.attribs[k]}
  closest(s){return wrap($(this.node).closest(s)[0])}matches(s){return $(this.node).is(s)}querySelectorAll(s){return $(this.node).find(s).toArray().map(wrap)}querySelector(s){return this.querySelectorAll(s)[0]||null}
  contains(node){while(node){if(node===this)return true;node=node.parentNode}return false}
  cloneNode(){return wrap($(this.node).clone()[0])}append(...nodes){for(const node of nodes)$(this.node).append(typeof node==='string'?node:node.node)}replaceChildren(){this.innerHTML=''}
  replaceWith(node){$(this.node).replaceWith(node.nodeType===11?[...node.node.children]:node.node)}after(node){$(this.node).after(node.node)}before(node){$(this.node).before(node.node)}remove(){$(this.node).remove()}
  addEventListener(){}focus(){}showModal(){this.open=true}close(){this.open=false}
}
function wrap(node){if(!node)return null;if(!wrappers.has(node))wrappers.set(node,new Element(node));return wrappers.get(node)}
const field=id=>wrap($('#'+id)[0]),body=field('bodyHtml');
let activeRange=null;
class Range {
  setStart(node,offset){this.startContainer=node;this.startOffset=offset}setEnd(node,offset){this.endContainer=node;this.endOffset=offset}
  selectNode(node){const i=node.parentNode.childNodes.indexOf(node);this.setStart(node.parentNode,i);this.setEnd(node.parentNode,i+1)}
  selectNodeContents(node){this.setStart(node,0);this.setEnd(node,node.childNodes.length)}setStartAfter(node){this.setStart(node.parentNode,node.parentNode.childNodes.indexOf(node)+1)}
  collapse(start){if(start)this.setEnd(this.startContainer,this.startOffset);else this.setStart(this.endContainer,this.endOffset);this.collapsed=true}
  createContextualFragment(html){return wrap(load(html,null,false).root()[0])}cloneRange(){return Object.assign(new Range(),this)}toString(){return''}
}
const context=vm.createContext({console,Promise,Date,JSON,URL,Element,$:field,bodyRange:()=>activeRange,document:{activeElement:null,createElement:tag=>wrap($('<'+tag+'>')[0]),addEventListener(){},createRange:()=>new Range()},window:{getSelection:()=>({removeAllRanges(){activeRange=null},addRange(range){activeRange=range}})}});
const run=s=>vm.runInContext(s,context),tick=()=>new Promise(resolve=>setImmediate(resolve));
run("let current={id:'media-synthetic'},busy=false,selectedMedia=null,formatRange=null,pendingFontSpans=null,pastedImageNodes=null,uploadRange=null,saves=0;function captureFormatRange(){formatRange=bodyRange()?.cloneRange()||null}function closeFormatPanels(){}function clearMediaSelection(){selectedMedia=null}function restoreFormatRange(){}function updateFormatState(){}function status(){}function schedule(){saves++;rememberEditorChange()}function formatCommand(){throw new Error('Existing media must never use native rich-text insertion')}function validLink(v){return /^https?:/.test(v)}function escapeFormatText(v){return v.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('\"','&quot;')}");
run(editorHistoryScript);run(extrasScript);
function setup(html){body.innerHTML=html;activeRange=null;run('resetEditorHistory()')}
function openImage(selector='figure.imageblock'){context.target=body.querySelector(selector);run("openExtra('image',target)")}
async function apply(){await field('applyExtra').onclick();await tick();assert.equal(field('extraError').textContent,'')}
async function roundTrip(before,after){assert.equal(run("editorHistoryCommand('undo')"),true);assert.equal(body.innerHTML,before);assert.equal(run("editorHistoryCommand('redo')"),true);assert.equal(body.innerHTML,after)}
const photo='<figure class="imageblock alignCenter" data-origin="preserve"><a href="https://example.com/photo"><img src="/media/synthetic.png" alt="car" width="900" height="520" data-origin="photo"></a><figcaption><em>126069km</em> <a href="https://example.com/context">설명</a></figcaption></figure>';
const original='<p>앞 본문 <strong>보존</strong></p>'+photo+'<p>뒤 본문 <a href="https://example.com/body">링크</a></p>';
setup(original);openImage();await apply();assert.equal(body.innerHTML,original,'Unchanged apply preserves caption markup, image/link attributes and body exactly');assert.equal(activeRange.startContainer,body.children[2]);assert.equal(run('saves'),0);
let previous=body.innerHTML;
for(let i=0;i<4;i++){openImage();field('extraCaption').value='126069km '+i;await apply();const after=body.innerHTML;assert.equal(body.querySelectorAll('figure').length,1);assert.equal(body.children[1].tagName,'FIGURE');assert.equal(body.children[0].outerHTML,load(original)('p').first().toString());assert.equal(body.children[2].outerHTML,load(original)('p').last().toString());assert.equal(body.querySelector('figure a').getAttribute('href'),'https://example.com/photo');assert.equal(activeRange.startContainer,body.children[2],'Post-apply typing starts in an outside paragraph');await roundTrip(previous,after);previous=after}
const edited=body.innerHTML;
setup(photo);for(let i=0;i<3;i++){openImage();field('extraCaption').value='설명 '+i;await apply();assert.equal(body.querySelectorAll('figure').length,1);assert.equal(body.querySelectorAll('p').length,1);assert.equal(activeRange.startContainer,body.children[1])}
// The reported four nested wrappers and two empty figures are preserved, not
// globally cleaned. An edit must not add a fifth wrapper or move the body.
const nested='<figure class="imageblock alignCenter"><br></figure>'.repeat(2)+'<p>사용자가 밖으로 옮긴 본문</p>'+'<figure class="imageblock alignCenter">'.repeat(3)+photo+'</figure>'.repeat(3);
setup(nested);for(let i=0;i<3;i++){openImage('figure[data-origin="preserve"]');field('extraCaption').value='126069km '+i;await apply();assert.equal(body.querySelectorAll('figure').length,6);assert.equal(body.querySelectorAll('p').length,2);assert.equal(body.children[2].textContent,'사용자가 밖으로 옮긴 본문');assert.equal(activeRange.startContainer.parentElement,body)}
const group='<div class="dwnc-image-layout dwnc-image-cols-2"><div class="dwnc-image-item">'+photo+'</div><div class="dwnc-image-item"><figure class="imageblock"><img src="/media/other.png" alt="other"><figcaption>두 번째</figcaption></figure></div></div>';
setup(group);openImage();field('extraCaption').value='첫 번째 변경';await apply();assert.equal(body.querySelectorAll('.dwnc-image-item').length,2);assert.equal(body.querySelectorAll('figure').length,2);assert.equal(body.querySelectorAll('figcaption')[1].textContent,'두 번째');assert.equal(activeRange.startContainer.parentElement,body);assert.equal(activeRange.startContainer.tagName,'P');
// Repeated edits of the other consumers of the same replacement helper.
const card='<figure data-ke-type="opengraph"><a href="https://example.com/"><span class="og-title">제목</span><span class="og-desc">설명</span></a></figure>';
setup(photo+card);const originalCard=body.querySelector('[data-ke-type="opengraph"]').outerHTML;for(let i=0;i<5;i++){openImage();field('extraCaption').value='인접 카드 앞 사진 '+i;await apply();assert.equal(body.querySelectorAll('figure').length,2);assert.equal(body.querySelectorAll('figure figure').length,0);assert.equal(body.querySelector('[data-ke-type="opengraph"]').outerHTML,originalCard);assert.equal(body.querySelector('figure.imageblock').querySelectorAll('img').length,1);assert.equal(body.querySelectorAll('p').length,1)}
setup('<p>앞</p>'+card+'<p>뒤</p>');for(let i=0;i<3;i++){context.target=body.querySelector('figure');run("openExtra('card',target)");field('extraCardTitle').value='카드 '+i;const before=body.innerHTML;await apply();assert.equal(body.querySelectorAll('figure').length,1);assert.equal(body.querySelectorAll('p').length,2);assert.equal(body.querySelector('figure').parentElement,body);await roundTrip(before,body.innerHTML)}
setup('<p>앞</p><table><tbody><tr><td>A</td><td style="text-align:right">B</td></tr></tbody></table><p>뒤</p>');context.target=body.querySelector('td');run("openExtra('table',target)");previous=body.innerHTML;run("editTable('rowAfter')");await tick();assert.equal(field('extraError').textContent,'');assert.equal(body.querySelectorAll('table').length,1);assert.equal(body.querySelectorAll('tr').length,2);assert.equal(body.querySelectorAll('td')[1].getAttribute('style'),'text-align:right');await roundTrip(previous,body.innerHTML);
// Native and legacy sanitization/save/reopen retain one figure and outside text.
for(const sanitize of [sanitizeNativeHtml,sanitizeLegacyHtml]){const clean=sanitize(edited),parsed=load(clean);assert.equal(parsed('figure').length,1);assert.equal(parsed('figure p').length,0);assert.equal(parsed('figure > a').attr('href'),'https://example.com/photo');assert.equal(sanitize(clean),clean)}
const db=await createEditorDatabase();seedLegacy(db);const store=new NativePostStore(db),draft=await store.createDraft({id:'daily',slug:'일상',label:'일상'});
for(const source of [draft,await store.getForAdmin('legacy-1')]){let post=await store.update(source.id,source.revision,{title:'Media replacement fixture',description:'Synthetic',bodyFormat:'html',bodyMarkdown:original,categoryId:'daily',tags:[],coverMediaId:null});post=await store.publish(post.id,post.revision);const publicBefore=(await store.getPublishedBySequence(post.globalSequence)).bodyHtml;post=await store.update(post.id,post.revision,{...post,bodyMarkdown:edited});const reopened=await store.getForAdmin(post.id);assert.equal(load(reopened.bodyHtml)('figure').length,1);assert.equal(load(reopened.bodyHtml)('figure p').length,0);assert.equal((await store.getPublishedBySequence(post.globalSequence)).bodyHtml,publicBefore)}
console.log(JSON.stringify({suite:'media-edit-replacement',status:'PASS',behavior:'repeated image/card edits do not nest or duplicate blocks; unchanged rich captions preserved; caret outside photos/groups; pre-existing wrappers/body retained; table replacement, undo/redo, native/legacy save/reopen'}));
