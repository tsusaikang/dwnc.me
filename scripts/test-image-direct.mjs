import assert from 'node:assert/strict';
import vm from 'node:vm';
import { load } from 'cheerio';
import { imageDirectScript, imageDirectToolsHtml, imageDirectOverlayHtml } from '../src/lib/admin-image-direct.ts';
import { imageLayoutScript } from '../src/lib/admin-image-layout.ts';
import { editorHistoryScript } from '../src/lib/admin-editor-history.ts';
import { sanitizeNativeHtml, sanitizeLegacyHtml } from '../src/lib/native-content.ts';

// Cheerio supplies parsing/selector semantics; this adapter supplies DOM moves.
// Pointer hit testing below uses deterministic rectangles. Actual browser layout
// and pointer input are exercised in serve-editor-fixture.mjs.
const $html=load('<div id="bodyHtml"></div><div id="imageTools">'+imageDirectToolsHtml+'</div>'+imageDirectOverlayHtml);
const wrappers=new WeakMap(),listeners=new Map(),widths=new Map();
let hit=null,caretNode=null;
class Element {
  constructor(node){this.node=node;this.dataset={};this.hidden=false;this.value='';this.rect={left:0,top:0,right:800,bottom:100,width:800,height:100};this.style={getPropertyValue:name=>this.styles()[name]?.replace(/\s*!important$/,'' )||'',getPropertyPriority:name=>/!important$/.test(this.styles()[name]||'')?'important':'',setProperty:(name,value,priority)=>{const styles=this.styles();styles[name]=value+(priority?' !important':'');this.writeStyles(styles)},removeProperty:name=>{const styles=this.styles();delete styles[name];this.writeStyles(styles)}};this.classList={contains:name=>(this.node.attribs.class||'').split(/\s+/).includes(name),add:(...names)=>this.node.attribs.class=[...new Set((this.node.attribs.class||'').split(/\s+/).filter(Boolean).concat(names))].join(' '),remove:(...names)=>this.node.attribs.class=(this.node.attribs.class||'').split(/\s+/).filter(name=>!names.includes(name)).join(' ')};}
  styles(){return Object.fromEntries((this.node.attribs.style||'').split(';').filter(value=>value.includes(':')).map(value=>{const index=value.indexOf(':');return[value.slice(0,index).trim(),value.slice(index+1).trim()]}))}
  writeStyles(styles){const value=Object.entries(styles).map(([key,value])=>key+':'+value).join(';');if(value)this.node.attribs.style=value;else delete this.node.attribs.style}
  get tagName(){return this.node.name?.toUpperCase()}
  get nodeType(){return this.node.type==='text'?3:1}
  get className(){return this.node.attribs.class||''} set className(value){this.node.attribs.class=value}
  get innerHTML(){return $html(this.node).html()} set innerHTML(value){$html(this.node).html(value)}
  get outerHTML(){return $html.html(this.node)}
  get textContent(){return $html(this.node).text()} set textContent(value){$html(this.node).text(value)}
  get childNodes(){return(this.node.children||[]).map(wrap)}
  get children(){return(this.node.children||[]).filter(node=>node.type==='tag').map(wrap)}
  get parentNode(){return this.node.parent?wrap(this.node.parent):null} get parentElement(){return this.parentNode}
  get nextSibling(){return this.node.next?wrap(this.node.next):null}
  get nextElementSibling(){return wrap($html(this.node).next()[0])} get previousElementSibling(){return wrap($html(this.node).prev()[0])}
  get complete(){return true} get naturalWidth(){return widths.get(this.getAttribute('src'))||0}
  get options(){return this.children}
  matches(selector){return $html(this.node).is(selector)}
  closest(selector){return wrap($html(this.node).closest(selector)[0])}
  querySelectorAll(selector){return $html(this.node).find(selector).toArray().map(wrap)} querySelector(selector){return this.querySelectorAll(selector)[0]||null}
  contains(node){while(node){if(node===this)return true;node=node.parentNode}return false}
  getAttribute(name){return this.node.attribs[name]??null} hasAttribute(name){return name in this.node.attribs} setAttribute(name,value){this.node.attribs[name]=String(value)} removeAttribute(name){delete this.node.attribs[name]}
  append(...nodes){for(const node of nodes)$html(this.node).append(node.node)}
  before(node){$html(this.node).before(node.node)}
  insertBefore(node,before){if(before)$html(before.node).before(node.node);else this.append(node)}
  remove(){$html(this.node).remove()}
  cloneNode(){return wrap($html(this.node).clone()[0])}
  getBoundingClientRect(){return this.rect}
  setPointerCapture(id){assert.equal(field('imageTools').hidden,false,'Capture must precede hiding the floating tools');this.captured=id}
  hasPointerCapture(id){return this.captured===id} releasePointerCapture(){this.captured=null}
  focus(){} addEventListener(name,fn){listeners.set(this.getAttribute('id')+':'+name,fn)}
}
function wrap(node){if(!node)return null;if(!wrappers.has(node))wrappers.set(node,new Element(node));return wrappers.get(node)}
const field=id=>wrap($html('#'+id)[0]),body=field('bodyHtml');
const document={createElement:tag=>wrap($html('<'+tag+'>')[0]),createRange:()=>({selectNodeContents(node){caretNode=node},collapse(){}}),elementFromPoint:()=>hit,addEventListener(name,fn){listeners.set('document:'+name,fn)}};
const context=vm.createContext({document,Element,$:field,window:{getSelection:()=>({removeAllRanges(){},addRange(){}}),addEventListener(){},requestAnimationFrame:()=>1,cancelAnimationFrame(){},innerHeight:900},Promise,Date,JSON,console});
vm.runInContext(`let current={id:'synthetic-photo'},busy=false,selectedMedia=null,uploadRange=null,formatRange=null,pendingFontSpans=null,pastedImageNodes=null;function status(message){lastStatus=message}let lastStatus='';function bodyRange(){return null}function captureFormatRange(){}function updateFormatState(){}function positionMediaSelection(){}function clearMediaSelection(){selectedMedia=null}function selectMedia(image){selectedMedia={image};}function schedule(){rememberEditorChange()}`,context);
vm.runInContext(editorHistoryScript,context);
for(const [start,end] of [['function layoutRoot','function openImageLayout'],['function layoutSizeAvailability','function updateLayoutSizes'],['function prepareLayoutItem','function applyImageLayout']])vm.runInContext(imageLayoutScript.slice(imageLayoutScript.indexOf(start),imageLayoutScript.indexOf(end)),context);
vm.runInContext(imageDirectScript,context);
const run=source=>vm.runInContext(source,context),tick=()=>new Promise(resolve=>setImmediate(resolve));
const src=letter=>'/media/native/'+letter.repeat(8)+'-'+letter.repeat(4)+'-4'+letter.repeat(3)+'-8'+letter.repeat(3)+'-'+letter.repeat(12)+'.png';
for(const [letter,width] of [['a',1400],['b',1400],['c',1400],['d',320]])widths.set(src(letter),width);
const photo=letter=>'<figure class="imageblock"><a href="https://example.test/'+letter+'"><img src="'+src(letter)+'" alt="'+letter+'" style="width:80%;height:30px"></a><figcaption><em>caption '+letter+'</em></figcaption></figure>';
const original='<h2>Heading</h2><p>Before <strong>bold</strong></p>'+photo('a')+'<p>Middle <em>italic</em></p>'+photo('b')+photo('c')+'<table><tbody><tr><td>Untouched</td></tr></tbody></table>'+photo('d')+'<p>After</p>';
body.innerHTML=original;run('resetEditorHistory()');
const image=letter=>body.querySelector('img[alt="'+letter+'"]');
function move(letter,target){context.moving=image(letter);context.target=target;return run('moveDirectPhoto(moving,target)')}
const group=(letter,other,side='after')=>move(letter,{type:'group',image:image(other),side});
const order=()=>body.querySelectorAll('img').map(node=>node.getAttribute('alt')).join('');
const checkpoint=()=>body.innerHTML;
const originalParagraphs=()=>body.querySelectorAll('h2,p,table').filter(node=>!node.closest('.dwnc-image-item')).map(node=>node.outerHTML).join('');
const surrounding=originalParagraphs();

assert.equal(group('b','a'),true);await tick();
assert.equal(body.querySelector('.dwnc-image-cols-2').querySelectorAll('figcaption').length,2);
assert.equal(originalParagraphs(),surrounding,'Text between the original photos must stay in place');
assert.equal(group('c','b'),true);await tick();assert.equal(body.querySelector('.dwnc-image-cols-3').children.length,3);
assert.equal(group('c','a','before'),true);await tick();assert.equal(order(),'cabd');
const beforeRejected=checkpoint();assert.equal(group('d','a'),false);assert.equal(checkpoint(),beforeRejected,'A fourth photo must not modify either side');
const grouped=checkpoint();
const middle=body.querySelectorAll('p').find(node=>node.textContent.startsWith('Middle'));
assert.equal(move('a',{type:'move',parent:body,before:middle.nextSibling}),true);await tick();
assert.equal(body.querySelector('.dwnc-image-cols-2').querySelectorAll('img').map(node=>node.getAttribute('alt')).join(''),'cb');
assert.equal(originalParagraphs(),surrounding);
const split=checkpoint();run("editorHistoryCommand('undo')");assert.equal(checkpoint(),grouped);run("editorHistoryCommand('redo')");assert.equal(checkpoint(),split);
assert.equal(move('b',{type:'move',parent:body,before:body.children.at(-1)}),true);await tick();
assert.equal(body.querySelectorAll('.dwnc-image-cols-2,.dwnc-image-cols-3').length,0);
assert.equal(body.querySelectorAll('figcaption').length,4);assert.equal(body.querySelectorAll('figcaption em').length,4);assert.equal(body.querySelectorAll('a').length,4);
assert.equal(originalParagraphs(),surrounding);

// Regroup differently, then carry format/text edits through the same history.
assert.equal(group('a','c','before'),true);await tick();
context.selected=image('a');run("selectMedia(selected);setDirectPhotoLayout('align','right');setDirectPhotoLayout('size','full')");await tick();
assert.equal(image('a').closest('.dwnc-image-layout').classList.contains('dwnc-image-full'),true);
context.selected=image('d');run("selectMedia(selected);setDirectPhotoLayout('size','full')");await tick();assert.equal(image('d').closest('.dwnc-image-layout'),null,'Small originals cannot get full-width layout');
const beforeTyping=checkpoint();body.children[0].innerHTML='Heading <strong>edited</strong>';run('schedule()');await tick();run("editorHistoryCommand('undo')");assert.equal(checkpoint(),beforeTyping);run("editorHistoryCommand('redo')");assert.ok(checkpoint().includes('Heading <strong>edited</strong>'));
for(const sanitize of [sanitizeNativeHtml,sanitizeLegacyHtml]){const clean=sanitize(checkpoint()),parsed=load(clean);assert.equal(parsed('figcaption').length,4);assert.equal(parsed('figcaption em').length,4);assert.equal(parsed('img').length,4);assert.equal(parsed('.dwnc-image-cols-2').length,1);assert.equal(parsed('.dwnc-image-full').length,1);assert.equal(sanitize(clean),clean);assert.ok(!clean.includes('photo-drop'));}

// Group shrink must re-evaluate the new per-image requirement (354 -> 720px).
body.innerHTML=photo('d')+photo('a');run('resetEditorHistory()');assert.equal(group('d','a'),true);await tick();
widths.set(src('d'),400);context.selected=image('d');run("selectMedia(selected);setDirectPhotoLayout('size','paragraph')");await tick();assert.equal(image('d').closest('.dwnc-image-layout').classList.contains('dwnc-image-paragraph'),true);
assert.equal(move('a',{type:'move',parent:body,before:null}),true);await tick();assert.equal(image('d').closest('.dwnc-image-layout').classList.contains('dwnc-image-original'),true);

// Hit targets: middle sides group, upper/lower edges split/move, captions/text move.
body.innerHTML=original;run('resetEditorHistory()');body.rect={left:10,right:810,top:100,bottom:1400,width:800,height:1300};
image('a').rect={left:20,right:720,top:200,bottom:500,width:700,height:300};image('a').closest('figure').rect=image('a').rect;
hit=image('a');context.moving=image('b');let target=run('directPhotoDropTarget(22,340,moving)');assert.equal(target.type,'group');assert.equal(target.side,'before');assert.equal(target.label,'옆에 놓아 함께 묶기');
target=run('directPhotoDropTarget(718,340,moving)');assert.equal(target.side,'after');
target=run('directPhotoDropTarget(100,207,moving)');assert.equal(target.type,'move');assert.equal(target.before,image('a').closest('figure'));
target=run('directPhotoDropTarget(100,493,moving)');assert.equal(target.type,'move');assert.equal(target.before,image('a').closest('figure').nextSibling);
hit=body.querySelector('p');hit.rect={left:10,right:810,top:120,bottom:160,width:800,height:40};target=run('directPhotoDropTarget(100,158,moving)');assert.equal(target.type,'move');assert.equal(target.before,hit.nextSibling);
assert.equal(checkpoint(),original,'Hit previews must never enter saved content');
// Inline photos may move out of text, but a block wrapper must never be inserted
// inside a text paragraph (HTML parsing would otherwise split its formatting).
body.innerHTML='<p style="text-align:right">앞 <a href="https://example.test/inline"><img src="'+src('a')+'" alt="a"></a> 뒤 <strong>서식</strong></p>'+photo('b');run('resetEditorHistory()');
const mixed=checkpoint();context.selected=image('a');run("selectMedia(selected);setDirectPhotoLayout('align','left')");assert.equal(checkpoint(),mixed);assert.equal(group('b','a'),false);assert.equal(checkpoint(),mixed);
assert.equal(move('a',{type:'move',parent:body,before:null}),true);await tick();assert.equal(body.children[0].outerHTML,'<p style="text-align:right">앞  뒤 <strong>서식</strong></p>');
assert.equal(group('b','a'),true);await tick();assert.equal(body.querySelector('.dwnc-image-cols-2').querySelectorAll('img').length,2);assert.equal(body.querySelector('p div'),null);
// The mobile handle uses the same drop path and keeps pointer capture until up.
body.innerHTML=original;run('resetEditorHistory()');context.selected=image('b');run('selectMedia(selected)');hit=image('a');hit.rect={left:20,right:720,top:200,bottom:500,width:700,height:300};
const handle=field('dragSelectedPhoto');let prevented=0;
const pointer={button:0,pointerId:11,currentTarget:handle,clientX:700,clientY:340,preventDefault(){prevented++}};
listeners.get('dragSelectedPhoto:pointerdown')(pointer);assert.equal(handle.captured,11);assert.equal(field('imageTools').hidden,true);
listeners.get('document:pointermove')(pointer);listeners.get('document:pointerup')(pointer);await tick();assert.equal(handle.captured,null);assert.equal(body.querySelector('.dwnc-image-cols-2').children.length,2);assert.equal(field('photoDropIndicator').hidden,true);assert.equal(prevented,3);
// Consecutive upload figures have no text block between them. Only their outer
// vertical margins accept a paragraph; an image, caption or row gutter does not.
body.innerHTML=photo('a')+photo('b');run('resetEditorHistory()');
body.rect={left:10,right:810,top:100,bottom:900,width:800,height:800};
function box(node,top,bottom){node.rect={left:20,right:720,top,bottom,width:700,height:bottom-top}}
box(body.children[0],130,330);box(body.children[1],370,570);
context.hit=body;
const gapTarget=(x,y,node=body)=>{context.hit=node;return run(`directPhotoTextTarget(${x},${y},hit)`)};
assert.ok(gapTarget(300,115),'First photo top margin is writable');
assert.ok(gapTarget(300,350),'Adjacent photo margin is writable');
assert.ok(gapTarget(300,590),'Last photo bottom margin is writable');
assert.equal(gapTarget(300,800),null,'A distant blank page area is not a photo gap');
assert.equal(gapTarget(300,200,image('a')),null);
assert.equal(gapTarget(300,320,body.querySelector('figcaption em')),null);
assert.equal(gapTarget(800,200),null,'Side whitespace beside a photo must not create a paragraph');
assert.equal(gapTarget(5,350),null);
const photosBefore=checkpoint();context.target=gapTarget(300,350);
const clickGap={button:0,clientX:300,clientY:350,target:body,preventDefault(){this.prevented=true},stopImmediatePropagation(){this.stopped=true}};
listeners.get('bodyHtml:pointerdown')(clickGap);listeners.get('bodyHtml:click')(clickGap);await tick();
assert.equal(clickGap.prevented,true);assert.equal(clickGap.stopped,true);
assert.equal(body.children[1].outerHTML,'<p><br></p>');assert.equal(caretNode,body.children[1]);assert.equal(order(),'ab');
const gapInserted=checkpoint();assert.equal(gapInserted,photo('a')+'<p><br></p>'+photo('b'));
box(body.children[1],338,362);
context.target=gapTarget(300,350,body.children[1]);assert.equal(context.target.paragraph,body.children[1]);assert.equal(run('enterPhotoText(target)'),true);await tick();assert.equal(checkpoint(),gapInserted,'Reentering an empty paragraph must not duplicate it');
context.target=gapTarget(300,365);assert.equal(context.target.paragraph,body.children[1]);run('enterPhotoText(target)');assert.equal(checkpoint(),gapInserted,'Clicking next to an existing empty paragraph reuses it');
run("editorHistoryCommand('undo')");assert.equal(checkpoint(),photosBefore);run("editorHistoryCommand('redo')");assert.equal(checkpoint(),gapInserted);
body.children[1].innerHTML='Between <strong>photos</strong>';run('schedule()');await tick();
const withText=checkpoint();assert.equal(gapTarget(300,350,body.children[1]),null,'Existing text editing is left to the browser');
run("editorHistoryCommand('undo')");assert.equal(checkpoint(),gapInserted);run("editorHistoryCommand('redo')");assert.equal(checkpoint(),withText);
for(const sanitize of [sanitizeNativeHtml,sanitizeLegacyHtml]){const clean=sanitize(withText);assert.ok(clean.includes('<p>Between <strong>photos</strong></p>'));assert.equal(load(clean)('img').length,2);assert.equal(load(clean)('figcaption em').length,2);assert.ok(!clean.includes('photo-text-hint'));assert.equal(sanitize(clean),clean)}
body.innerHTML=photosBefore;run('resetEditorHistory()');box(body.children[0],130,330);box(body.children[1],370,570);
listeners.get('bodyHtml:pointerdown')(clickGap);listeners.get('bodyHtml:pointermove')({...clickGap,buttons:1,clientY:380});listeners.get('bodyHtml:click')(clickGap);assert.equal(checkpoint(),photosBefore,'Dragging from a margin must not insert text');
run('busy=true');assert.equal(gapTarget(300,350),null);run('busy=false;editorComposing=true');assert.equal(gapTarget(300,350),null);run('editorComposing=false');
assert.equal(group('b','a'),true);await tick();const row=body.querySelector('.dwnc-image-layout');box(row,130,330);assert.equal(gapTarget(300,250,row),null,'A grouped row interior is not a paragraph gap');
context.selected=image('a');run('startDirectPhotoDrag(selected)');assert.equal(gapTarget(300,350),null,'Photo dragging disables paragraph insertion');run('stopDirectPhotoDrag()');
// All boundaries use the same insertion path, including a single photo and an
// intact grouped row. The real fixture additionally verifies that editor CSS
// keeps the leading/trailing margin inside the editable element's hit area.
function clickTextMargin(y,node=body){const event={...clickGap,clientY:y,target:node};listeners.get('bodyHtml:pointerdown')(event);listeners.get('bodyHtml:click')(event);return event}
for(const kind of ['single','consecutive','group']){
  body.innerHTML=photo('a')+(kind==='single'?'':photo('b'));run('resetEditorHistory()');
  if(kind==='group'){assert.equal(group('b','a'),true);await tick()}
  const pristine=checkpoint(),imageOrder=order();
  for(const edge of ['before','after']){
    body.innerHTML=pristine;run('resetEditorHistory()');
    const roots=body.children;roots.forEach((node,index)=>box(node,136+240*index,336+240*index));
    const y=edge==='before'?118:roots.at(-1).getBoundingClientRect().bottom+18;
    assert.equal(clickTextMargin(y).stopped,true,kind+' '+edge+' must accept the real click path');await tick();
    const paragraph=edge==='before'?body.children[0]:body.children.at(-1);
    assert.equal(paragraph.outerHTML,'<p><br></p>');assert.equal(caretNode,paragraph);assert.equal(order(),imageOrder);
    assert.equal(checkpoint(),edge==='before'?'<p><br></p>'+pristine:pristine+'<p><br></p>');
    const inserted=checkpoint();box(paragraph,y-10,y+10);clickTextMargin(y,paragraph);await tick();assert.equal(checkpoint(),inserted,kind+' '+edge+' empty paragraph is reused');
    run("editorHistoryCommand('undo')");assert.equal(checkpoint(),pristine);run("editorHistoryCommand('redo')");assert.equal(checkpoint(),inserted);
    const textParagraph=edge==='before'?body.children[0]:body.children.at(-1);textParagraph.innerHTML='Boundary <strong>text</strong>';run('schedule()');await tick();
    const written=checkpoint();for(const sanitize of [sanitizeNativeHtml,sanitizeLegacyHtml]){const saved=sanitize(written),reopened=load(saved);assert.equal(reopened('img').length,kind==='single'?1:2);assert.equal(reopened('figcaption em').length,kind==='single'?1:2);assert.ok(saved.includes('<p>Boundary <strong>text</strong></p>'));assert.equal(reopened('.dwnc-image-cols-2').length,kind==='group'?1:0);assert.ok(!saved.includes('photoTextHint'))}
  }
}
console.log(JSON.stringify({suite:'image-direct',status:'PASS',behavior:'move/group/reorder/split, cap at three, captions and text preserved, shared undo/redo, sanitizer reopen, no-upscale, photo margin text insertion/reuse/caret and pointer exclusions'}));
