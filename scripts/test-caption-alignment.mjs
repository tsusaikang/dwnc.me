import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { load } from 'cheerio';
import postcss from 'postcss';
import { IMPORTED_PRESENTATION_CSS } from '../src/lib/imported-presentation.ts';
import { formattingScript } from '../src/lib/admin-formatting.ts';
import { sanitizeNativeHtml, sanitizeLegacyHtml } from '../src/lib/native-content.ts';
import { NativePostStore } from '../src/lib/native-post-store.ts';
import { createEditorDatabase, seedLegacy } from './fixtures/editor-database.mjs';

// Check the shared CSS contract on native, legacy and Naver markup. The main
// browser fixture checks the actual cascade in editor, preview and public pages.
const alignmentRules=[];
postcss.parse(IMPORTED_PRESENTATION_CSS).walkRules(rule=>{for(const declaration of rule.nodes)if(declaration.prop==='text-align'&&!/:{1,2}(?:before|after)\b/.test(rule.selector))alignmentRules.push({selector:rule.selector,value:declaration.value,important:declaration.important})});
const globalCss=await readFile(new URL('../src/styles/global.css',import.meta.url),'utf8');
postcss.parse(globalCss).walkRules(rule=>{if(/figcaption|se-caption|se_mediaCaption/.test(rule.selector))assert.equal(rule.nodes.some(node=>node.prop==='text-align'),false,'Global styles must not override the shared caption alignment contract')});
const captionSelector='figcaption,.se-caption,.se_mediaCaption';
const ruleFor=(dom,element)=>alignmentRules.filter(rule=>dom(element).is(rule.selector)).at(-1);
for(const surface of ['prose','html-editor'])for(const wrapper of ['', 'legacy-content','naver-content'])for(const caption of ['<figcaption>설명</figcaption>','<div class="se-caption"><p>설명</p></div>','<div class="se_mediaCaption"><p>설명</p></div>']){
  const dom=load(`<section class="${surface}" style="text-align:right"><div class="${wrapper}"><p>일반 본문</p><figure class="imageblock alignLeft" style="text-align:left">${caption}</figure></div></section>`),node=dom(captionSelector)[0];
  assert.equal(ruleFor(dom,node).value,'center');assert.equal(Boolean(ruleFor(dom,node).important),false);
  assert.equal(dom('p').first().attr('style'),undefined,'A display default does not add styles to body paragraphs');
  for(const [attribute,value] of [['align','right'],['class',(dom(node).attr('class')||'')+' se_align-left']]){const old=dom(node).attr(attribute);dom(node).attr(attribute,value);assert.equal(ruleFor(dom,node).value,attribute==='align'?'right':'left');old===undefined?dom(node).removeAttr(attribute):dom(node).attr(attribute,old)}
}
for(const surface of ['prose','html-editor'])for(const cls of ['se_align-left','se-text-paragraph-align-right']){const dom=load(`<section class="${surface}"><div class="naver-content"><div class="se-caption"><p class="${cls}">작성자 정렬</p></div></div></section>`);assert.equal(ruleFor(dom,dom('p')[0]).value,cls.endsWith('left')?'left':'right')}

// Exercise the real toolbar state functions with a browser-command answer that
// intentionally disagrees with the caption's visible CSS alignment.
const helpers=formattingScript.slice(formattingScript.indexOf('function captionFormatAlignment'),formattingScript.indexOf('function sizePresetValue'));
const commands=['bold','italic','justifyLeft','justifyCenter','justifyRight','justifyFull'];
const buttons=commands.map(command=>({dataset:{formatCommand:command},setAttribute(name,value){this[name]=value}}));
let activeRange=null,visibleAlign='center',direction='ltr',isCaption=true;
const captionElement={nodeType:1,childNodes:[],closest:()=>isCaption?captionElement:null};
const textNode={nodeType:3,parentElement:captionElement};captionElement.childNodes=[textNode];
const field=id=>id==='formatToolbar'?{querySelectorAll:()=>buttons}:{};
const context=vm.createContext({$:field,bodyRange:()=>activeRange,showCurrentFontSize(){},window:{getComputedStyle:()=>({textAlign:visibleAlign,direction})},document:{queryCommandState:cmd=>cmd==='bold'||cmd==='justifyLeft',queryCommandValue:()=> 'p'}});
vm.runInContext(helpers,context);
for(const [align,dir,expected] of [['center','ltr','justifyCenter'],['left','ltr','justifyLeft'],['right','ltr','justifyRight'],['justify','ltr','justifyFull'],['start','rtl','justifyRight'],['end','rtl','justifyLeft']]){visibleAlign=align;direction=dir;activeRange={commonAncestorContainer:textNode,startContainer:textNode,startOffset:0};vm.runInContext('updateFormatState()',context);assert.equal(buttons.find(button=>button.dataset.formatCommand===expected)['aria-pressed'],'true');assert.equal(buttons.filter(button=>button.dataset.formatCommand.startsWith('justify')&&button['aria-pressed']==='true').length,1);assert.equal(buttons[0]['aria-pressed'],'true','Non-alignment button state keeps its existing behavior')}
isCaption=false;visibleAlign='center';vm.runInContext('updateFormatState()',context);assert.equal(buttons.find(button=>button.dataset.formatCommand==='justifyLeft')['aria-pressed'],'true','Ordinary body selection retains native command state');

const markup='<p style="text-align:right">일반 본문</p><figure class="imageblock alignLeft"><img src="/media/native/12345678-1234-4234-8234-123456789abc.png" alt="합성"><figcaption>기본 설명</figcaption></figure><figure class="imageblock alignRight"><img src="/media/native/12345678-1234-4234-8234-123456789abc.png" alt="합성"><figcaption style="text-align:left"><em>명시 왼쪽</em></figcaption></figure><figure class="imageblock"><figcaption align="right">명시 오른쪽</figcaption></figure>';
for(const sanitize of [sanitizeNativeHtml,sanitizeLegacyHtml]){const clean=sanitize(markup),dom=load(clean);assert.equal(dom('figcaption').first().attr('style'),undefined);assert.equal(dom('figcaption').eq(1).attr('style'),'text-align:left');assert.equal(dom('figcaption').eq(1).find('em').text(),'명시 왼쪽');assert.equal(dom('figcaption').eq(2).attr('align'),'right');assert.equal(dom('p').attr('style'),'text-align:right');assert.equal(dom('figure').first().attr('class'),'imageblock alignLeft');assert.equal(sanitize(clean),clean)}
const naver='<div class="naver-content"><div class="se-caption"><p class="se-text-paragraph-align-left"><span>명시 설명</span></p></div><div class="se_mediaCaption" style="text-align:right">명시 오른쪽</div></div>';
assert.equal(sanitizeLegacyHtml(naver),naver);
const db=await createEditorDatabase();seedLegacy(db);const store=new NativePostStore(db),draft=await store.createDraft({id:'daily',slug:'일상',label:'일상'});
for(const source of [draft,await store.getForAdmin('legacy-1')]){const input={title:'Caption alignment fixture',description:'Synthetic',bodyFormat:'html',bodyMarkdown:markup,categoryId:'daily',tags:[],coverMediaId:null};const post=await store.update(source.id,source.revision,input),reopened=await store.getForAdmin(post.id),dom=load(reopened.bodyHtml);assert.equal(dom('figcaption').first().attr('style'),undefined);assert.equal(dom('figcaption').eq(1).attr('style'),'text-align:left');assert.equal(dom('figcaption').eq(2).attr('align'),'right');assert.equal(dom('p').attr('style'),'text-align:right');assert.equal(reopened.bodyHtml,post.bodyHtml)}
console.log(JSON.stringify({suite:'caption-alignment',status:'PASS',behavior:'shared default across editor/public/native/legacy/Naver, explicit style/class/align preserved, CSS-aware caption toolbar with ordinary body behavior unchanged, save/reopen preservation'}));
