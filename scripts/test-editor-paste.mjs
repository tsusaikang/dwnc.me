import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createContext, runInContext } from 'node:vm';
import { webcrypto } from 'node:crypto';
import { htmlPasteDetectorScript } from '../src/lib/html-source-paste.ts';
const ui=await readFile(new URL('../src/lib/admin-ui.ts',import.meta.url),'utf8');
const formatting=await readFile(new URL('../src/lib/admin-formatting.ts',import.meta.url),'utf8');
const uploadSource=ui.slice(ui.indexOf('function clipboardImages('),ui.indexOf("$('upload').onclick="));
const pasteSource=formatting.slice(formatting.indexOf('function pasteHtmlSource('),formatting.indexOf("$('bodyHtml').addEventListener('input'"));
class Node {
 constructor(tag='',text=''){this.tag=tag;this.text=text;this.children=[];this.parentNode=null;this.hidden=false;this.value='';this.handlers={}}
 append(...nodes){for(const node of nodes){node.parentNode=this;this.children.push(node)}}
 get lastChild(){return this.children.at(-1)}
 get innerHTML(){return this.text+this.children.map(node=>node.tag==='img'?'<img src="'+node.src+'" alt="'+node.alt+'">':node.tag?'<'+node.tag+'>'+node.innerHTML+'</'+node.tag+'>':node.innerHTML).join('')}
 contains(node){return this===node||this.children.some(child=>child.contains(node))}
 querySelectorAll(){return []}
 addEventListener(type,handler){this.handlers[type]=handler}
}
const fields={bodyHtml:new Node(),image:new Node(),uploadPanel:new Node()};
const makeRange=(index=1)=>({index,commonAncestorContainer:fields.bodyHtml,cloneRange(){return makeRange(this.index)},deleteContents(){},insertNode(node){node.parentNode=fields.bodyHtml;fields.bodyHtml.children.splice(this.index,0,node)},setStartAfter(node){this.index=fields.bodyHtml.children.indexOf(node)+1},collapse(){},selectNodeContents(){this.index=fields.bodyHtml.children.length},createContextualFragment(html){return new Node('',html)}});
let historyChanges=0;
let selectionRange=makeRange(), uploads=[],saved=[],messages=[],failUpload=false,failFlush=false,failHtml=false;
const doc={createElement:tag=>new Node(tag),createTextNode:text=>new Node('',text),createRange:()=>makeRange(),};
const win={getSelection:()=>({rangeCount:1,getRangeAt:()=>selectionRange,removeAllRanges(){},addRange(range){selectionRange=range}})};
const ctx=createContext({document:doc,window:win,crypto:webcrypto,Uint8Array,Array,Set,JSON,encodeURIComponent,console,$:id=>fields[id],status:text=>messages.push(text),bodyRange:()=>selectionRange,clearMediaSelection(){},captureEditorBefore(){},rememberEditorChange(){historyChanges++},closeFormatPanels(){},renderSaveState(){},setTimeout(){},clearTimeout(){},api:async(path,options)=>{
 if(path==='/html-paste'){if(failHtml){failHtml=false;throw new Error('synthetic authentication_required')}return {html:'<p><strong>합성 서식</strong></p>',omitted:true}}
 assert.equal(path,'/posts/synthetic-post/media');assert.equal(options.method,'POST');assert.equal(options.headers['content-type'],'image/png');assert.equal(Number(options.headers['x-dwnc-file-size']),options.body.byteLength);assert.equal(options.headers['x-dwnc-file-sha256'].length,64);
 if(failUpload){failUpload=false;throw new Error('synthetic authentication_required')}
 const publicPath='/media/native/synthetic-'+(uploads.length+1)+'.png';uploads.push(publicPath);return {media:{publicPath}};
}});
runInContext(`let editorTyping=null;let current={id:'synthetic-post'},busy=false,dirty=false,change=0,uploadQueue=[],uploadRange=null,retryAction=null,formatRange=null,pastedImageNodes=null;async function action(work){if(busy)return;busy=true;try{await work()}catch(error){retryAction=work;status('synthetic failed')}finally{busy=false}}function schedule(allowBusy=false){if(busy&&allowBusy!==true)return;dirty=true;change++}`,ctx);
ctx.flush=async()=>{if(failFlush){failFlush=false;return false}saved.push(fields.bodyHtml.innerHTML);return true};
runInContext(htmlPasteDetectorScript+uploadSource+pasteSource,ctx);
const file=(name='paste.png',extra={})=>({name,type:'image/png',size:3,arrayBuffer:async()=>new Uint8Array([1,2,3]).buffer,...extra});
const paste=async({files=[],items=[],plain='',rich=''}={})=>{let prevented=false;await fields.bodyHtml.handlers.paste({preventDefault(){prevented=true},clipboardData:{files,items,getData:type=>type==='text/plain'?plain:rich}});return prevented};
const reset=()=>{fields.bodyHtml.children=[];fields.bodyHtml.append(new Node('p','앞 문단'),new Node('p','뒤 문단'));selectionRange=makeRange();historyChanges=0;uploads=[];saved=[];messages=[];runInContext('uploadQueue=[];uploadRange=null;busy=false;dirty=false;retryAction=null',ctx)};
reset();const photo=file();assert.equal(await paste({files:[photo],items:[{kind:'file',type:'image/png',getAsFile:()=>photo}]}),true);assert.equal(uploads.length,1,'files/items duplicate must upload once');assert.equal(historyChanges,1,'Uploaded image participates in body history');assert.match(saved.at(-1),/^<p>앞 문단<\/p><figure>.*<\/figure><p>뒤 문단<\/p>$/);assert.equal(runInContext('uploadQueue.length',ctx),0);
reset();await paste({files:[photo],plain:'함께 복사한 설명'});assert.match(saved.at(-1),/앞 문단.*함께 복사한 설명.*<figure>.*뒤 문단/);
reset();await paste({items:[{kind:'file',type:'image/png',getAsFile:()=>photo}]});assert.equal(uploads.length,1,'items fallback');
reset();await paste({files:[file('first.png'),file('second.png')]});assert.equal(uploads.length,2);assert.ok(saved.at(-1).indexOf('synthetic-1')<saved.at(-1).indexOf('synthetic-2'));
reset();const originalFlush=ctx.flush;let saveAttempts=0;ctx.flush=async()=>{if(++saveAttempts===2)return false;return originalFlush()};await paste({files:[file('first.png'),file('second.png')]});assert.equal(uploads.length,1);assert.equal(runInContext('uploadQueue.length',ctx),1);await runInContext('action(retryAction)',ctx);ctx.flush=originalFlush;assert.equal(uploads.length,2,'partial save failure resumes remaining file without reupload');assert.equal((saved.at(-1).match(/<figure>/g)||[]).length,2);
reset();failUpload=true;await paste({files:[photo]});assert.equal(uploads.length,0);assert.equal(runInContext('uploadQueue.length',ctx),1);assert.match(fields.bodyHtml.innerHTML,/앞 문단.*뒤 문단/);await runInContext('action(retryAction)',ctx);assert.equal(uploads.length,1);assert.equal(runInContext('uploadQueue.length',ctx),0);
reset();failFlush=true;await paste({files:[photo]});assert.equal(uploads.length,0);assert.equal(runInContext('retryAction===uploadImage',ctx),true);await runInContext('action(retryAction)',ctx);assert.equal(uploads.length,1);
reset();for(const invalid of [file('x.svg',{type:'image/svg+xml'}),file('big.png',{size:26*1024*1024})])await paste({files:[invalid]});assert.equal(uploads.length,0);assert.equal(runInContext('uploadQueue.length',ctx),0);
reset();ctx.pendingPhoto=photo;runInContext('uploadQueue=[pendingPhoto]',ctx);await paste({files:[file('new.png')]});assert.equal(runInContext('uploadQueue[0].name',ctx),'paste.png');assert.equal(uploads.length,0);
reset();runInContext('busy=true',ctx);assert.equal(await paste({files:[photo]}),true);assert.equal(uploads.length,0);runInContext('busy=false',ctx);
reset();assert.equal(await paste({plain:'평범한 글자 < 3'}),false);assert.equal(await paste({plain:'복사된 서식',rich:'<p>복사된 서식</p>'}),false,'existing rich text stays native');
reset();assert.equal(await paste({plain:'<p><strong>합성 서식</strong></p>',rich:'<pre style="color:red">&lt;p&gt;HTML code&lt;/p&gt;</pre>'}),true);assert.match(fields.bodyHtml.innerHTML,/앞 문단.*<strong>합성 서식<\/strong>.*뒤 문단/);assert.equal(runInContext('dirty',ctx),true);assert.match(messages.at(-1),/제외/);
reset();failHtml=true;const raw='<h2>실패해도 남는 합성 원문</h2>';await paste({plain:raw});assert.ok(fields.bodyHtml.innerHTML.includes(raw));assert.equal(runInContext('dirty',ctx),true);assert.match(messages.at(-1),/원문을 글자로/);
console.log('PASS editor clipboard images and HTML source paste: cursor/order/ownership upload/retry/input preservation/rich-text fallback');
