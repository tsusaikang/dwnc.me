import { TAXONOMY } from './taxonomy.ts';

function jsonForScript(value: unknown) {
  return JSON.stringify(value).replace(/</gu, '\\u003c');
}

export function adminHtml(identityEmail: string) {
  const categories = TAXONOMY.map(({ id, label }) => ({ id, label }));
  const nativeImagePattern = String.raw`!\[([^\]]*)\]\((\/media\/native\/[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}\.(?:avif|gif|jpe?g|png|webp))\)`;
  return `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>dwnc.me 글쓰기</title>
<style>
:root{font-family:system-ui,sans-serif;color:#171717;background:#f5f5f2}
*{box-sizing:border-box}
body{margin:0}
header{padding:16px 24px;background:#171717;color:#fff;display:flex;justify-content:space-between}
main{display:grid;grid-template-columns:280px 1fr;min-height:calc(100vh - 56px)}
aside{padding:18px;border-right:1px solid #ccc}
section{padding:24px;max-width:1000px}
.row{display:flex;gap:10px;align-items:center;flex-wrap:wrap}.grow{flex:1}
input,textarea,select,button{font:inherit}
input,textarea,select{width:100%;padding:10px;border:1px solid #aaa;border-radius:5px;background:#fff}
textarea,.html-editor{min-height:42vh}
.html-editor-shell{position:relative;overflow:hidden;border-radius:5px}
.html-editor{padding:14px;border:1px solid #aaa;border-radius:5px;background:#fff;overflow:auto}
.html-editor img{max-width:100%;height:auto}
.html-editor figure.imageblock,.html-editor .se_component.se_image,.html-editor .se-component.se-image{display:block;margin:18px 0;padding:8px;border:1px solid #e2e2dc;border-radius:7px}
.html-editor figure[data-ke-type="opengraph"],.html-editor .se_component.se_oglink,.html-editor .se-component.se-oglink{display:block;margin:18px 0;border:1px solid #c8c8c0;border-radius:8px;background:#fafaf7;overflow:hidden}
.html-editor figure[data-ke-type="opengraph"]>a{display:grid;grid-template-columns:minmax(120px,32%) 1fr;color:inherit;text-decoration:none}
.html-editor .se-oglink-info{display:block;color:inherit;text-decoration:none}.html-editor .se-oglink-info:has(.se-oglink-thumbnail){display:grid;grid-template-columns:minmax(120px,32%) 1fr}
.html-editor .og-image,.html-editor .se-oglink-thumbnail{min-height:110px;background:#e8e8e2}
.html-editor .og-image img,.html-editor .se-oglink-thumbnail img{display:block;width:100%;height:100%;min-height:110px;object-fit:cover}
.html-editor .og-image__label{display:grid;min-height:110px;place-items:center;color:#666;font-size:.9rem}
.html-editor .og-text,.html-editor .se-oglink-info-container{min-width:0;padding:14px}
.html-editor .og-title,.html-editor .se-oglink-title{display:-webkit-box;margin:0 0 6px;overflow:hidden;font-weight:750;line-height:1.35;-webkit-box-orient:vertical;-webkit-line-clamp:2}
.html-editor .og-desc,.html-editor .se-oglink-summary{display:-webkit-box;margin:0 0 9px;overflow:hidden;color:#555;font-size:.92rem;line-height:1.45;-webkit-box-orient:vertical;-webkit-line-clamp:3}
.html-editor .og-host,.html-editor .se-oglink-url{margin:0;color:#777;font-size:.82rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.media-selection-outline{position:absolute;z-index:2;border:3px solid #1264d1;border-radius:7px;box-shadow:0 0 0 3px rgba(18,100,209,.18);pointer-events:none}
.image-tools{position:fixed;z-index:20;display:flex;align-items:center;justify-content:space-between;gap:12px;max-width:calc(100vw - 24px);padding:10px 12px;border:1px solid #9bb8df;border-radius:7px;background:#eef5ff;box-shadow:0 4px 18px rgba(0,0,0,.18)}
.image-tools button{background:#9b1c1c}.image-tools__label{font-weight:650;color:#123c73}
.markdown-media{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:10px;margin-top:10px}
.markdown-media button{display:block;padding:7px;border:2px solid transparent;background:#fff;color:#222;text-align:left}
.markdown-media button[aria-pressed="true"]{border-color:#1264d1;box-shadow:0 0 0 3px rgba(18,100,209,.18)}
.markdown-media img{display:block;width:100%;height:120px;object-fit:cover;border-radius:4px}.markdown-media span{display:block;margin-top:6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
textarea{resize:vertical}
label{display:block;margin:14px 0 5px;font-weight:650}
button{padding:9px 14px;border:0;border-radius:5px;background:#222;color:#fff;cursor:pointer}
button.secondary{background:#666}button.publish{background:#075b2a}button:disabled{opacity:.5}
.posts{list-style:none;padding:0}.posts button{width:100%;margin:3px 0;text-align:left;background:#fff;color:#222;border:1px solid #ddd}
.status{min-height:1.5em;color:#555}
.save-state{position:sticky;top:0;z-index:10;padding:10px 0;background:#f5f5f2;border-bottom:1px solid #ddd}.save-state p{margin:4px 0}.save-detail{font-size:.9rem;color:#555}.save-issue{padding:12px;margin:10px 0;background:#fff4df;border:1px solid #c98920;border-radius:5px}.save-issue p{margin:0 0 10px}.save-issue a{color:#174e9c}.save-state [hidden],.save-issue [hidden]{display:none}
.preview{padding:18px;background:#fff;border:1px solid #ccc;margin-top:16px}.preview img{max-width:100%;height:auto}
@media(max-width:760px){main{display:block}aside{border-right:0;border-bottom:1px solid #ccc}.html-editor figure[data-ke-type="opengraph"]>a,.html-editor .se-oglink-info:has(.se-oglink-thumbnail){display:block}}
</style></head><body>
<header><strong>dwnc.me 글쓰기</strong><span>${identityEmail.replace(/[&<>"']/gu, '')}</span></header>
<main><aside><button id="new">새 글</button><ul id="posts" class="posts"></ul></aside>
<section><div class="row"><h1 id="heading" class="grow">글을 선택하세요</h1><button id="preview" class="secondary" disabled>미리보기</button><button id="publish" class="publish" disabled>공개 반영</button></div>
<div class="save-state" aria-live="polite"><p id="saveStatus">글을 선택하면 작업본 저장 상태가 표시됩니다.</p><p id="lastSaved" class="save-detail"></p></div>
<div id="saveIssue" class="save-issue" role="alert" hidden><p id="issueMessage"></p><div class="row"><button id="retrySave" type="button">다시 시도</button><a id="loginLink" href="/" target="_blank" rel="noopener">새 탭에서 로그인</a><button id="resumeLogin" type="button" class="secondary">로그인 완료 · 이어서 저장</button><button id="loadLatest" type="button" class="secondary" hidden>현재 입력 대신 최신 작업본 불러오기</button><button id="keepLocal" type="button" hidden>현재 작성본 유지</button></div></div>
<p id="status" class="status" aria-live="polite"></p>
<form id="editor" hidden><label>제목<input id="title" maxlength="180"></label><label>요약<input id="description" maxlength="320"></label><div class="row"><label class="grow">카테고리<select id="category"></select></label><label class="grow">태그 (쉼표 구분)<input id="tags"></label></div><label id="bodyLabel" for="body">본문 (Markdown)</label><textarea id="body"></textarea><div id="markdownMedia" class="markdown-media" aria-label="본문 이미지" hidden></div><div id="bodyHtmlShell" class="html-editor-shell" hidden><div id="bodyHtml" class="html-editor" contenteditable="true" role="textbox" aria-multiline="true"></div><div id="mediaSelectionOutline" class="media-selection-outline" hidden></div></div><div id="imageTools" class="image-tools" role="toolbar" aria-label="선택한 본문 이미지" hidden><span id="imageSelectionLabel" class="image-tools__label"></span><button id="deleteImage" type="button">선택 항목 삭제</button></div><div class="row"><input id="image" type="file" accept="image/avif,image/gif,image/jpeg,image/png,image/webp"><button id="upload" type="button" class="secondary">이미지 올리고 본문에 넣기</button></div></form><article id="previewBox" class="preview" hidden></article></section></main>
<script>
const categories=${jsonForScript(categories)};let current=null,timer=null,saving=null,dirty=false,change=0,selectedMedia=null,busy=false,blocked=null,retryAction=null,lastSavedAt=null;
const $=id=>document.getElementById(id), status=m=>$('status').textContent=m;
for(const c of categories){const o=document.createElement('option');o.value=c.id;o.textContent=c.label;$('category').append(o)}
function requestError(message,code){const error=new Error(message);error.code=code;return error}
async function api(path,options={}){
  const controller=new AbortController(),deadline=setTimeout(()=>controller.abort(),path.endsWith('/media')?120000:30000);
  try{
  let r;try{r=await fetch('/api'+path,{credentials:'same-origin',redirect:'manual',cache:'no-store',...options,signal:controller.signal,headers:{'content-type':'application/json',...(options.headers||{})}})}catch{throw requestError(controller.signal.aborted?'응답이 늦어 저장 성공을 확인하지 못했습니다. 작성 내용은 유지됩니다. 다시 시도하세요.':'연결하지 못했습니다. 인터넷 연결을 확인하고 다시 시도하세요. 로그인이 만료됐다면 새 탭에서 로그인할 수 있습니다.','connection_failed')}
  if(r.type==='opaqueredirect'||r.status===401||r.status===403||r.status>=300&&r.status<400)throw requestError('로그인이 필요합니다. 이 탭을 그대로 두고 새 탭에서 로그인한 뒤 돌아오세요.','authentication_required');
  const contentType=r.headers.get('content-type')||'';if(!contentType.includes('application/json'))throw requestError(contentType.includes('text/html')?'로그인이 필요합니다. 이 탭을 그대로 두고 새 탭에서 로그인한 뒤 돌아오세요.':'서버 응답을 확인하지 못했습니다. 다시 시도하세요.',contentType.includes('text/html')?'authentication_required':'invalid_response');
  let j;try{j=await r.json()}catch{throw requestError('서버 응답을 확인하지 못했습니다. 다시 시도하세요.','invalid_response')}
  if(!r.ok)throw requestError(j.error||'요청을 완료하지 못했습니다.',j.code||(r.status===409?'revision_conflict':'request_failed'));return j;
  }finally{clearTimeout(deadline)}
}
function renderSaveState(){
  if(!current)return;
  const publicState=current.status==='published'?'방문자는 마지막으로 공개 반영한 내용을 봅니다.':'아직 방문자에게 공개되지 않았습니다.';
  let message=saving?'작업본 저장 중…':dirty?'작업본에 아직 저장하지 못한 변경이 있습니다.':'작업본 저장됨';
  if(blocked==='conflict')message='다른 곳에서 수정됨 · 현재 작성 내용은 이 화면에 유지됩니다.';
  else if(blocked==='review')message='현재 작성본 유지 중 · 아래 저장 버튼을 누를 때까지 자동저장을 멈춥니다.';
  else if(blocked==='authentication_required')message='로그인 필요 · 현재 작성 내용은 이 화면에 유지됩니다.';
  else if(blocked)message='요청 실패 · 현재 작성 내용은 이 화면에 유지됩니다.';
  else if(!dirty&&!saving&&current.status==='published')message+=current.revision===current.publishedRevision?' · 공개 내용과 같습니다.':' · 공개 반영을 기다리는 변경이 있습니다.';
  $('saveStatus').textContent=message;$('lastSaved').textContent=(lastSavedAt?'마지막 저장 성공: '+new Date(lastSavedAt).toLocaleString('ko-KR'):'아직 저장 성공을 확인하지 못했습니다.')+' · '+publicState;
}
function setBusy(value){busy=value;for(const id of ['new','preview','publish','upload','retrySave','resumeLogin','loadLatest','keepLocal'])$(id).disabled=value||(['preview','publish','upload'].includes(id)&&!current);for(const node of $('posts').querySelectorAll('button'))node.disabled=value;for(const id of ['title','description','category','tags','body','image'])$(id).disabled=value;$('bodyHtml').contentEditable=value?'false':'true';$('deleteImage').disabled=value}
function clearIssue(){blocked=null;retryAction=null;$('saveIssue').hidden=true;renderSaveState()}
function showIssue(error,retry){
  clearTimeout(timer);blocked=error.code==='revision_conflict'?'conflict':error.code||'request_failed';retryAction=retry;$('saveIssue').hidden=false;
  $('issueMessage').textContent=blocked==='conflict'?'다른 탭이나 세션에서 먼저 저장했습니다. 현재 입력 대신 최신 작업본을 불러오거나, 현재 작성본을 유지한 뒤 직접 저장할 수 있습니다.':error.message;
  const conflict=blocked==='conflict';$('loadLatest').hidden=!conflict;$('keepLocal').hidden=!conflict;$('retrySave').hidden=conflict||blocked==='authentication_required';$('retrySave').textContent='다시 시도';$('loginLink').hidden=conflict;$('resumeLogin').hidden=conflict;renderSaveState();
}
async function action(work){if(busy)return;setBusy(true);try{await work()}catch(error){showIssue(error,work)}finally{setBusy(false);renderSaveState()}}
function values(){return{title:$('title').value,description:$('description').value,bodyMarkdown:current?.bodyFormat==='html'?$('bodyHtml').innerHTML:$('body').value,categoryId:$('category').value,tags:$('tags').value.split(',').map(v=>v.trim()).filter(Boolean),coverMediaId:current?.coverMediaId||null}}
function clearMediaSelection(){if(selectedMedia?.kind==='markdown-image')selectedMedia.node.setAttribute('aria-pressed','false');selectedMedia=null;$('mediaSelectionOutline').hidden=true;$('imageTools').hidden=true}
function positionImageTools(node){const tools=$('imageTools'),box=node.getBoundingClientRect(),tool=tools.getBoundingClientRect(),gap=8,margin=12;let top=box.top-tool.height-gap;if(top<margin)top=box.bottom+gap;top=Math.max(margin,Math.min(top,window.innerHeight-tool.height-margin));let left=box.right-tool.width;left=Math.max(margin,Math.min(left,window.innerWidth-tool.width-margin));tools.style.top=top+'px';tools.style.left=left+'px'}
function positionMediaSelection(){if(!selectedMedia)return;if(selectedMedia.kind==='markdown-image'){if(!$('markdownMedia').contains(selectedMedia.node)){clearMediaSelection();return}$('mediaSelectionOutline').hidden=true;positionImageTools(selectedMedia.node);return}if(!$('bodyHtml').contains(selectedMedia.node)){clearMediaSelection();return}const shell=$('bodyHtmlShell'),box=selectedMedia.node.getBoundingClientRect(),host=shell.getBoundingClientRect(),outline=$('mediaSelectionOutline');outline.style.left=box.left-host.left+shell.scrollLeft+'px';outline.style.top=box.top-host.top+shell.scrollTop+'px';outline.style.width=box.width+'px';outline.style.height=box.height+'px';outline.hidden=false;positionImageTools(selectedMedia.node)}
function mediaTarget(node){const card=node.closest('figure[data-ke-type="opengraph"],.se_component.se_oglink,.se-component.se-oglink');if(card)return{node:card,kind:'link-card'};const block=node.closest('figure.imageblock,.se_component.se_image,.se-component.se-image');return{node:block||node,kind:'image'}}
function selectMedia(node){const selection=mediaTarget(node),label=selection.kind==='link-card'?'링크 미리보기 카드':'본문 이미지';selectedMedia=selection;$('bodyHtml').focus({preventScroll:true});$('imageSelectionLabel').textContent=label+'가 선택되었습니다.';$('deleteImage').textContent=selection.kind==='link-card'?'링크 카드 삭제':'이미지 삭제';$('imageTools').hidden=false;positionMediaSelection();status(label+' 선택됨 · Delete 또는 Backspace로 삭제할 수 있습니다.')}
function markdownImageRanges(value){const images=[],pattern=new RegExp(${jsonForScript(nativeImagePattern)},'g'),fence=String.fromCharCode(96).repeat(3);let fenced=false,offset=0;for(const line of value.split(String.fromCharCode(10))){if(line.trim().startsWith(fence))fenced=!fenced;else if(!fenced){pattern.lastIndex=0;for(const match of line.matchAll(pattern))images.push({alt:match[1]||'본문 이미지',path:match[2],start:offset+match.index,end:offset+match.index+match[0].length})}offset+=line.length+1}return images}
function selectMarkdownMedia(node,image){clearMediaSelection();selectedMedia={node,kind:'markdown-image',start:image.start,end:image.end};node.setAttribute('aria-pressed','true');node.focus({preventScroll:true});$('imageSelectionLabel').textContent='본문 이미지가 선택되었습니다.';$('deleteImage').textContent='이미지 삭제';$('imageTools').hidden=false;positionMediaSelection();status('본문 이미지 선택됨 · Delete 또는 Backspace로 삭제할 수 있습니다.')}
function renderMarkdownMedia(){const container=$('markdownMedia'),images=current?.bodyFormat==='html'?[]:markdownImageRanges($('body').value);container.replaceChildren();container.hidden=!images.length;for(const image of images){const button=document.createElement('button'),preview=document.createElement('img'),label=document.createElement('span');button.type='button';button.setAttribute('aria-pressed','false');button.setAttribute('aria-label',(image.alt||'본문 이미지')+' 선택');preview.src=image.path;preview.alt=image.alt;preview.loading='lazy';label.textContent=image.alt||'본문 이미지';button.append(preview,label);button.onclick=event=>{event.preventDefault();selectMarkdownMedia(button,image)};container.append(button)}}
function placeCaret(parent,next){$('bodyHtml').focus();const range=document.createRange();if(next&&$('bodyHtml').contains(next))range.setStartBefore(next);else if(parent&&$('bodyHtml').contains(parent))range.setStart(parent,parent.childNodes.length);else range.selectNodeContents($('bodyHtml'));range.collapse(true);const selection=window.getSelection();selection.removeAllRanges();selection.addRange(range)}
function deleteSelectedMedia(){if(busy||!selectedMedia)return false;if(selectedMedia.kind==='markdown-image'){const start=selectedMedia.start,end=selectedMedia.end;clearMediaSelection();$('body').setRangeText('',start,end,'end');$('body').focus();schedule();status('이미지를 삭제했습니다. 저장 대기 중입니다.');return true}if(!$('bodyHtml').contains(selectedMedia.node))return false;const target=selectedMedia.node,parent=target.parentNode,next=target.nextSibling,kind=selectedMedia.kind;clearMediaSelection();target.remove();placeCaret(parent,next);schedule();status(kind==='link-card'?'링크 카드를 삭제했습니다. 저장 대기 중입니다.':'이미지를 삭제했습니다. 저장 대기 중입니다.');return true}
function fill(p){clearTimeout(timer);clearMediaSelection();dirty=false;change=0;current=p;lastSavedAt=p.updatedAt;clearIssue();$('editor').hidden=false;$('heading').textContent=p.title||'제목 없는 작업본';$('title').value=p.title;$('description').value=p.description;const html=p.bodyFormat==='html';$('body').hidden=html;$('bodyHtmlShell').hidden=!html;$('bodyLabel').htmlFor=html?'bodyHtml':'body';$('bodyLabel').textContent=html?'본문':'본문 (Markdown)';$('body').value=html?'':p.bodyMarkdown;$('bodyHtml').innerHTML=html?p.bodyMarkdown:'';$('category').value=p.categoryId;$('tags').value=p.tags.join(', ');$('image').value='';renderMarkdownMedia();$('previewBox').hidden=true;setBusy(busy);status('입력은 작업본에만 자동저장됩니다. 공개 반영을 눌러야 방문자에게 보입니다.');renderSaveState()}
async function list(){const {posts}=await api('/posts');const ul=$('posts');ul.replaceChildren();for(const p of posts){const li=document.createElement('li'),b=document.createElement('button'),number=p.globalSequence?'#'+p.globalSequence+' ':'';b.textContent=number+(p.status==='published'?'공개 ':'작업본 ')+(p.title||'제목 없음');b.dataset.postId=p.id;b.disabled=busy;b.onclick=()=>action(async()=>{if(!await flush())return;fill((await api('/posts/'+encodeURIComponent(p.id))).post)});li.append(b);ul.append(li)}}
async function refreshList(){try{await list()}catch(error){showIssue(error,list)}}
function updateListTitle(post){for(const button of $('posts').querySelectorAll('button')){if(button.dataset.postId===post.id)button.textContent=(post.globalSequence?'#'+post.globalSequence+' ':'')+(post.status==='published'?'공개 ':'작업본 ')+(post.title||'제목 없음')}}
async function flush(){
  clearTimeout(timer);if(blocked)return false;
  while(current&&(dirty||saving)){
    if(saving){if(!await saving)return false;continue}
    const postId=current.id,expected=current.revision,snapshot=values(),savedChange=change;
    saving=(async()=>{try{
      const post=(await api('/posts/'+encodeURIComponent(postId),{method:'PUT',body:JSON.stringify({expectedRevision:expected,input:snapshot})})).post;
      if(current?.id!==postId)return false;
      current=post;lastSavedAt=post.updatedAt;dirty=change!==savedChange;$('heading').textContent=post.title||'제목 없는 작업본';updateListTitle(post);return true;
    }catch(error){dirty=true;showIssue(error,async()=>{await flush()});return false}})();
    renderSaveState();const ok=await saving;saving=null;renderSaveState();if(!ok)return false;
  }
  return true;
}
function schedule(){if(!current||busy)return;if(current.bodyFormat!=='html')renderMarkdownMedia();dirty=true;change+=1;renderSaveState();clearTimeout(timer);if(!blocked)timer=setTimeout(()=>{void flush()},800)}
for(const id of ['title','description','category','tags'])$(id).addEventListener('input',schedule);
$('body').addEventListener('input',()=>{clearMediaSelection();schedule()});
$('bodyHtml').addEventListener('input',()=>{schedule();positionMediaSelection()});
$('bodyHtml').addEventListener('click',event=>{const element=event.target instanceof Element?event.target:null;if(!element){clearMediaSelection();return}const image=element.closest('img'),card=element.closest('figure[data-ke-type="opengraph"],.se_component.se_oglink,.se-component.se-oglink'),link=element.closest('a');if(link)event.preventDefault();if(card&&$('bodyHtml').contains(card)){event.preventDefault();selectMedia(card.querySelector('img')||card);return}if(image&&$('bodyHtml').contains(image)){event.preventDefault();selectMedia(image);return}clearMediaSelection()});
$('bodyHtml').addEventListener('keydown',event=>{if(selectedMedia&&(event.key==='Delete'||event.key==='Backspace')){event.preventDefault();deleteSelectedMedia()}else if(event.key==='Escape'&&selectedMedia){event.preventDefault();clearMediaSelection()}else if(selectedMedia)clearMediaSelection()});
$('bodyHtml').addEventListener('scroll',positionMediaSelection);
window.addEventListener('resize',positionMediaSelection);
window.addEventListener('scroll',positionMediaSelection,true);
document.addEventListener('click',event=>{const element=event.target instanceof Element?event.target:null;if(!element||(!$('bodyHtml').contains(element)&&!$('markdownMedia').contains(element)&&!$('imageTools').contains(element)))clearMediaSelection()});
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&selectedMedia){event.preventDefault();clearMediaSelection()}else if(selectedMedia?.kind==='markdown-image'&&(event.key==='Delete'||event.key==='Backspace')){event.preventDefault();deleteSelectedMedia()}});
$('deleteImage').onclick=()=>deleteSelectedMedia();
$('editor').addEventListener('submit',event=>event.preventDefault());
$('new').onclick=()=>action(async()=>{if(!await flush())return;fill((await api('/posts',{method:'POST',body:'{}'})).post);await refreshList()});
$('preview').onclick=()=>action(async()=>{if(!current||!await flush())return;const {html}=await api('/posts/'+encodeURIComponent(current.id)+'/preview',{method:'POST',body:JSON.stringify({input:values()})});$('previewBox').innerHTML=html;$('previewBox').hidden=false;status('현재 작업본 미리보기입니다. 아직 공개 반영하지 않은 변경도 포함합니다.')});
$('publish').onclick=()=>action(async()=>{if(!current||!await flush())return;status('저장한 최신 작업본을 공개 반영하는 중…');const post=(await api('/posts/'+encodeURIComponent(current.id)+'/publish',{method:'POST',body:JSON.stringify({expectedRevision:current.revision})})).post;current=post;lastSavedAt=post.updatedAt;dirty=false;updateListTitle(post);renderSaveState();status('공개 반영 완료 · 방문자에게 최신 작업본이 표시됩니다.');await refreshList()});
async function uploadImage(){
  const f=$('image').files[0];if(!f||!current){status('이미지를 선택하세요.');return}if(!await flush())return;
  status('이미지 올리는 중…');const postId=current.id,bytes=new Uint8Array(await f.arrayBuffer()),hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(b=>b.toString(16).padStart(2,'0')).join('');
  const j=await api('/posts/'+encodeURIComponent(postId)+'/media',{method:'POST',headers:{'content-type':f.type,'x-dwnc-file-size':String(f.size),'x-dwnc-file-sha256':hash,'x-dwnc-file-name':encodeURIComponent(f.name)},body:bytes});
  if(current?.id!==postId)return;
  const name=(f.name||'이미지').replace(/[<>&"']/g,'');
  if(current.bodyFormat==='html'){
    const figure=document.createElement('figure'),span=document.createElement('span'),image=document.createElement('img');figure.className='imageblock alignCenter';image.src=j.media.publicPath;image.alt=name;image.loading='lazy';image.decoding='async';span.append(image);figure.append(span);
    const selection=window.getSelection();if(selection.rangeCount&&$('bodyHtml').contains(selection.getRangeAt(0).commonAncestorContainer)){const range=selection.getRangeAt(0);range.deleteContents();range.insertNode(figure);range.setStartAfter(figure);range.collapse(true);selection.removeAllRanges();selection.addRange(range)}else $('bodyHtml').append(figure);
  }else{const area=$('body'),insert=String.fromCharCode(10)+'!['+name.split('[').join('').split(']').join('')+']('+j.media.publicPath+')'+String.fromCharCode(10);area.setRangeText(insert,area.selectionStart,area.selectionEnd,'end')}
  clearMediaSelection();renderMarkdownMedia();dirty=true;change+=1;$('image').value='';renderSaveState();await flush();status(blocked?'이미지는 본문에 넣었습니다. 작업본 저장을 다시 시도하세요.':'이미지를 본문에 넣고 작업본에 저장했습니다.');
}
$('upload').onclick=()=>action(uploadImage);
$('retrySave').onclick=()=>{const retry=retryAction||flush;return action(async()=>{clearIssue();await retry();if(!blocked&&dirty)await flush()})};
$('resumeLogin').onclick=()=>{const retry=retryAction||flush;return action(async()=>{try{await list()}catch(error){showIssue(error,retry);return}clearIssue();await retry();if(!blocked&&dirty)await flush();if(!blocked)status('로그인을 확인했습니다. 작성 내용을 이어서 처리했습니다.')})};
$('loadLatest').onclick=()=>action(async()=>{if(!current)return;const post=(await api('/posts/'+encodeURIComponent(current.id))).post;fill(post);status('최신 작업본을 불러왔습니다. 이전에 이 화면에서 작성한 내용 대신 표시합니다.')});
$('keepLocal').onclick=()=>action(async()=>{
  if(!current)return;const latest=(await api('/posts/'+encodeURIComponent(current.id))).post;
  current={...latest,coverMediaId:current.coverMediaId};dirty=true;blocked='review';retryAction=async()=>{await flush()};$('issueMessage').textContent='현재 작성 내용은 그대로 유지했습니다. 아래 버튼을 누르면 다른 곳에서 저장한 최신 작업본을 현재 작성 내용으로 바꿉니다. 공개 글은 공개 반영 전까지 바뀌지 않습니다.';$('retrySave').textContent='현재 작성본으로 저장';$('retrySave').hidden=false;$('loadLatest').hidden=false;$('keepLocal').hidden=true;$('loginLink').hidden=true;$('resumeLogin').hidden=true;renderSaveState();
});
window.addEventListener('beforeunload',event=>{if(dirty||saving||busy){event.preventDefault();event.returnValue=''}});
void action(list);

</script></body></html>`;
}
