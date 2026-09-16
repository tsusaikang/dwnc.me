import assert from 'node:assert/strict';
import vm from 'node:vm';
import { editorHistoryScript } from '../src/lib/admin-editor-history.ts';
import { extrasScript } from '../src/lib/admin-extras.ts';
const listeners=new Map();
const body={innerHTML:'<p>처음</p>',childNodes:[],focus(){},addEventListener(name,fn){const all=listeners.get(name)||[];all.push(fn);listeners.set(name,all)}};
const context=vm.createContext({Promise,Date,JSON,console,body,$:()=>body,bodyRange:()=>null,status(){},clearMediaSelection(){},captureFormatRange(){},updateFormatState(){},window:{getSelection:()=>({removeAllRanges(){},addRange(){}})},document:{createRange:()=>({selectNodeContents(){},collapse(){}})}});
vm.runInContext("let current={id:'synthetic-1'},busy=false,pendingFontSpans=null,pastedImageNodes=null,uploadRange=null,formatRange=null;function schedule(){rememberEditorChange()}",context);
vm.runInContext(editorHistoryScript,context);
const run=source=>vm.runInContext(source,context),tick=()=>new Promise(resolve=>setImmediate(resolve));
const event=(type,data={})=>{for(const fn of listeners.get(type)||[])fn({preventDefault(){},stopImmediatePropagation(){},...data})};
const change=async html=>{body.innerHTML=html;run('rememberEditorChange()');await tick()};
run('resetEditorHistory()');
await change('<p>입력</p>');
await change('<p><strong>입력</strong></p>');
await change('<div class="dwnc-image-layout"><p><strong>입력</strong></p></div>');
for(const html of ['<p><strong>입력</strong></p>','<p>입력</p>','<p>처음</p>']){assert.equal(run("editorHistoryCommand('undo')"),true);assert.equal(body.innerHTML,html)}
assert.equal(run("editorHistoryCommand('undo')"),false);
assert.equal(run("editorHistoryCommand('redo')"),true);
await change('<p>새 갈래</p>');assert.equal(run("editorHistoryCommand('redo')"),false);
const beforeComposition=run('editorUndoStates.length');event('compositionstart');
body.innerHTML='<p>ㅎ</p>';event('input');await tick();
body.innerHTML='<p>하</p>';event('input');await tick();
assert.equal(run('editorUndoStates.length'),beforeComposition);
body.innerHTML='<p>한글</p>';event('compositionend');await tick();
assert.equal(run('editorUndoStates.length'),beforeComposition+1);
run("editorHistoryCommand('undo')");assert.equal(body.innerHTML,'<p>새 갈래</p>');
run("current={id:'synthetic-2'}");body.innerHTML='<p>다른 글</p>';run('resetEditorHistory()');assert.equal(run("editorHistoryCommand('undo')"),false);
for(let i=0;i<100;i++)await change('<p>'+i+'</p>');assert.ok(run('editorUndoStates.length')<=80);
// The HTML modal replaces the entire document, even when an old selection is
// inside its first nested block. The exact original structure must be undoable.
const replaceHtmlSource=extrasScript.match(/function replaceEditorHtml\(html\)\{[^\n]+\}/)?.[0];
assert.ok(replaceHtmlSource);vm.runInContext(replaceHtmlSource,context);
assert.ok(extrasScript.includes('replaceEditorHtml(result.editorHtml);return'));
const originalHtml='<div class="naver-content"><div class="se_doc_viewer"><div class="blog2_series"><span>원래 분류</span></div><p>원래 본문</p></div></div>';
const replacementHtml='<div class="naver-content"><div class="se_doc_viewer"><div class="blog2_series"><span>원래 분류</span></div><p>바꾼 본문</p><figure><a href="https://example.test/">수정 카드</a></figure></div></div>';
for(const selection of [null,{startOffset:0,collapsed:true},{startOffset:2,collapsed:false}]){
  body.innerHTML=originalHtml;run('resetEditorHistory()');context.staleSelection=selection;run('formatRange=staleSelection');context.replacementHtml=replacementHtml;
  assert.equal(run('replaceEditorHtml(replacementHtml)'),true);await tick();
  assert.equal(body.innerHTML,replacementHtml);
  assert.equal((body.innerHTML.match(/class="naver-content"/g)||[]).length,1);
  assert.equal(run("editorHistoryCommand('undo')"),true);assert.equal(body.innerHTML,originalHtml);
  assert.equal(run("editorHistoryCommand('redo')"),true);assert.equal(body.innerHTML,replacementHtml);
}
console.log(JSON.stringify({suite:'editor-body-history',status:'PASS',behavior:'typing/format/layout order, exact whole-HTML replacement regardless of selection, undo/redo branch, IME one transaction, post reset and bounded memory'}));
