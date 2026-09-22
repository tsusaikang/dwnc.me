import assert from 'node:assert/strict';
import vm from 'node:vm';
import { load } from 'cheerio';
import { extrasHtml, extrasScript } from '../src/lib/admin-extras.ts';
import { editorHistoryScript } from '../src/lib/admin-editor-history.ts';
import { sanitizeNativeHtml, sanitizeLegacyHtml } from '../src/lib/native-content.ts';
import { NativePostStore } from '../src/lib/native-post-store.ts';
import { createEditorDatabase, seedLegacy } from './fixtures/editor-database.mjs';

const $=load('<div id="bodyHtml"></div>'+extrasHtml+'<button id="moreTools"></button><select id="fontFamily"></select><button id="editSelectedMedia"></button><div id="uploadPanel"></div>');
const wrappers=new WeakMap();
class Element {
  constructor(node){this.node=node;this.dataset=new Proxy({}, {get:(_,key)=>this.getAttribute('data-'+key.replace(/[A-Z]/g,c=>'-'+c.toLowerCase())),set:(_,key,value)=>{this.setAttribute('data-'+key.replace(/[A-Z]/g,c=>'-'+c.toLowerCase()),value);return true}});this.style={getPropertyValue:key=>(this.styles()[key]||'').replace(/\s*!important$/,''),removeProperty:key=>{const values=this.styles();delete values[key];this.writeStyles(values)},setProperty:(key,value,priority)=>this.writeStyles({...this.styles(),[key]:value+(priority?' !important':'')})};this.classList={add:value=>$(node).addClass(value),contains:value=>$(node).hasClass(value)}}
  styles(){return Object.fromEntries((this.getAttribute('style')||'').split(';').filter(v=>v.includes(':')).map(v=>{const i=v.indexOf(':');return[v.slice(0,i).trim(),v.slice(i+1).trim()]}))}
  writeStyles(values){this.setAttribute('style',Object.entries(values).map(([k,v])=>k+':'+v).join(';'))}
  get id(){return this.getAttribute('id')}set id(v){this.setAttribute('id',v)}
  get className(){return this.getAttribute('class')}set className(v){this.setAttribute('class',v)}
  get nodeType(){return this.node.type==='text'?3:1}get tagName(){return this.node.name?.toUpperCase()}
  get textContent(){return $(this.node).text()}set textContent(v){$(this.node).text(v)}
  get innerHTML(){return $(this.node).html()}set innerHTML(v){$(this.node).html(v)}get outerHTML(){return $.html(this.node)}
  get children(){return $(this.node).children().toArray().map(wrap)}get childNodes(){return(this.node.children||[]).map(wrap)}
  get parentNode(){return wrap(this.node.parent)}get parentElement(){return this.parentNode}
  get colSpan(){return Number(this.getAttribute('colspan')||1)}get rowSpan(){return Number(this.getAttribute('rowspan')||1)}
  getAttribute(k){return this.node.attribs[k]??null}setAttribute(k,v){this.node.attribs[k]=String(v)}removeAttribute(k){delete this.node.attribs[k]}
  closest(selector){return wrap($(this.node).closest(selector)[0])}querySelectorAll(selector){return $(this.node).find(selector).toArray().map(wrap)}querySelector(selector){return this.querySelectorAll(selector)[0]||null}
  contains(node){while(node){if(node===this)return true;node=node.parentNode}return false}
  append(...nodes){for(const node of nodes)$(this.node).append(node.node)}replaceChildren(){this.innerHTML=''}
  addEventListener(){}focus(){}showModal(){this.open=true}close(){this.open=false}
}
function wrap(node){if(!node)return null;if(!wrappers.has(node))wrappers.set(node,new Element(node));return wrappers.get(node)}
const field=id=>wrap($('#'+id)[0]),body=field('bodyHtml');
const context=vm.createContext({console,Promise,Date,JSON,Element,$:field,document:{activeElement:null,createElement:tag=>wrap($('<'+tag+'>')[0]),addEventListener(){},createRange:()=>({selectNodeContents(){},collapse(){}})},window:{getSelection:()=>({removeAllRanges(){},addRange(){}})}});
const run=source=>vm.runInContext(source,context),tick=()=>new Promise(resolve=>setImmediate(resolve));
run("let current={id:'table-synthetic'},busy=false,selectedMedia=null,formatRange=null,pendingFontSpans=null,pastedImageNodes=null,uploadRange=null,saves=0;function bodyRange(){return null}function captureFormatRange(){}function closeFormatPanels(){}function clearMediaSelection(){}function restoreFormatRange(){}function updateFormatState(){}function status(){}function schedule(){saves++;rememberEditorChange()}");
run(editorHistoryScript);run(extrasScript);
const original='<p>Before <strong>unchanged</strong></p><table class="authored-table-style" align="right" style="width:60%;float:right;margin-inline:0 auto;border:1px solid red"><caption>Caption</caption><tbody><tr><th colspan="2" style="text-align:center">Heading</th></tr><tr><td rowspan="2" style="text-align:right">A <em>text</em></td><td style="text-align:left">B</td></tr><tr><td>C</td></tr></tbody></table><p>After unchanged</p>';
body.innerHTML=original;run('resetEditorHistory()');
function open(){context.cell=body.querySelector('td');run("openExtra('table',cell)")}
open();assert.equal(field('extraContent').querySelector('legend').textContent,'표 위치');
let buttons=field('extraContent').querySelectorAll('[data-table-position]');assert.equal(buttons.length,3);assert.equal(buttons.find(b=>b.dataset.tablePosition==='right').getAttribute('aria-pressed'),'true');assert.equal(buttons.every(b=>!b.disabled),true,'Merged cells do not disable table positioning');
const interior=body.querySelector('table').innerHTML,surrounding=body.querySelectorAll('p').map(n=>n.outerHTML).join('');
const outputs=[];
for(const position of ['left','center','right']){
  const before=body.innerHTML;buttons.find(b=>b.dataset.tablePosition===position).onclick();await tick();
  const table=body.querySelector('table');assert.equal(table.innerHTML,interior);assert.equal(body.querySelectorAll('p').map(n=>n.outerHTML).join(''),surrounding);assert.equal(table.style.getPropertyValue('width'),'60%');assert.equal(table.getAttribute('align'),null);assert.equal(table.style.getPropertyValue('float'),'');assert.equal(table.style.getPropertyValue('margin-inline'),'');assert.equal(table.style.getPropertyValue('margin-left'),position==='left'?'0':'auto');assert.equal(table.style.getPropertyValue('margin-right'),position==='right'?'0':'auto');assert.equal(buttons.filter(b=>b.getAttribute('aria-pressed')==='true').length,1);assert.equal(buttons.find(b=>b.dataset.tablePosition===position).getAttribute('aria-pressed'),'true');
  const after=body.innerHTML;outputs.push(after);run("editorHistoryCommand('undo')");assert.equal(body.innerHTML,before);run("editorHistoryCommand('redo')");assert.equal(body.innerHTML,after);open();buttons=field('extraContent').querySelectorAll('[data-table-position]');assert.equal(buttons.find(b=>b.dataset.tablePosition===position).getAttribute('aria-pressed'),'true');
  const savedCount=run('saves');buttons.find(b=>b.dataset.tablePosition===position).onclick();await tick();assert.equal(run('saves'),savedCount,'Repeated same position is not a new body change');
}
run('busy=true');assert.equal(run("setTablePosition('left')"),false);run('busy=false');context.detached=field('extraContent');run('extraTarget=detached');assert.equal(run("setTablePosition('left')"),false);
body.innerHTML=original.replace('width:60%','width:100%');run('resetEditorHistory()');open();assert.equal(run("setTablePosition('center')"),true);await tick();assert.equal(body.querySelector('table').style.getPropertyValue('width'),'100%','Choosing a position must not shrink an explicitly full-width table');
for(const sanitize of [sanitizeNativeHtml,sanitizeLegacyHtml])for(const markup of outputs){const clean=sanitize(markup),parsed=load(clean),table=parsed('table');assert.equal(table.hasClass('dwnc-table-positioned'),true);assert.equal(table.hasClass('authored-table-style'),true,'Existing table classes survive sanitization');assert.match(table.attr('style'),/width:60%/);assert.equal(parsed('th').attr('colspan'),'2');assert.equal(parsed('td').first().attr('rowspan'),'2');assert.equal(parsed('td').first().attr('style'),'text-align:right');assert.equal(parsed('td em').text(),'text');assert.equal(sanitize(clean),clean)}
// Save and reopen both source types. A positioned working copy remains separate
// from the published body until explicit publication in this synthetic database.
const db=await createEditorDatabase();seedLegacy(db);const store=new NativePostStore(db);
const draft=await store.createDraft({id:'daily',slug:'일상',label:'일상'});
for(const source of [draft,await store.getForAdmin('legacy-1')]){
  let post=await store.update(source.id,source.revision,{title:'Table placement fixture',description:'Synthetic',bodyFormat:'html',bodyMarkdown:original,categoryId:'daily',tags:[],coverMediaId:null});
  post=await store.publish(post.id,post.revision);const baseline=(await store.getPublishedBySequence(post.globalSequence)).bodyHtml;
  for(const markup of outputs){post=await store.update(post.id,post.revision,{...post,bodyMarkdown:markup});assert.equal((await store.getPublishedBySequence(post.globalSequence)).bodyHtml,baseline);const reopened=await store.getForAdmin(post.id);assert.equal(load(reopened.bodyHtml)('table').hasClass('dwnc-table-positioned'),true);assert.equal(load(reopened.bodyHtml)('table').hasClass('authored-table-style'),true);assert.match(load(reopened.bodyHtml)('table').attr('style'),/width:60%/)}
  post=await store.publish(post.id,post.revision);assert.equal((await store.getPublishedBySequence(post.globalSequence)).bodyHtml,post.bodyHtml);
}
console.log(JSON.stringify({suite:'table-position',status:'PASS',behavior:'separate table positioning and active state, merged/cell formatting and explicit width preserved, undo/redo, repeated click no-op, native/legacy save/reopen and public isolation'}));
