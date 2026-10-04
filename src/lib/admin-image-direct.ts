// Editing controls and drop indicators live outside bodyHtml. Only the existing
// saved layout vocabulary is moved into the post, so saving and history remain
// shared with normal text editing.
export const imageDirectToolsHtml = `<div id="directImageTools" class="direct-image-tools" hidden><button id="dragSelectedPhoto" type="button" title="끌어서 이동 · 방향키로 위치 이동" aria-label="선택 사진 이동">↕ 이동</button><div class="photo-number-tools"><span id="directPhotoNumber" aria-live="polite"></span><label for="directPhotoPosition">옮길 번호</label><input id="directPhotoPosition" type="number" inputmode="numeric" min="1" step="1" aria-describedby="directPhotoNumberHint"><button id="movePhotoByNumber" type="button">번호로 이동</button><button id="openPhotoOrder" type="button" aria-haspopup="dialog" aria-controls="photoOrderDialog">전체 사진 순서</button></div><span id="directPhotoNumberHint" class="direct-photo-hint">번호는 본문 사진 순서입니다. 다른 그룹 안으로 옮기면 그 줄이 나뉩니다.</span><div class="photo-align-tools" role="group" aria-label="사진 정렬"><button type="button" data-photo-align="left" aria-label="사진 왼쪽 정렬">왼쪽</button><button type="button" data-photo-align="center" aria-label="사진 가운데 정렬">가운데</button><button type="button" data-photo-align="right" aria-label="사진 오른쪽 정렬">오른쪽</button></div><label class="sr-only" for="directPhotoSize">사진 크기</label><select id="directPhotoSize" aria-describedby="directPhotoHint"><option value="original">100% 원본</option><option value="paragraph">문단 폭</option><option value="full">전체 폭</option></select><button id="splitSelectedPhoto" type="button" hidden>한 장 빼내기</button><span id="directPhotoHint" class="direct-photo-hint"></span></div>`;

export const imageDirectOverlayHtml = `<div id="photoNumberOverlay" class="photo-number-overlay" aria-label="본문 사진 번호"></div><div id="photoDropIndicator" class="photo-drop-indicator" hidden><span id="photoDropLabel"></span></div><div id="photoTextHint" class="photo-text-hint" aria-hidden="true" hidden>＋ 글 쓰기</div><dialog id="photoOrderDialog" class="photo-order-dialog" aria-labelledby="photoOrderHeading" aria-describedby="photoOrderHint"><div class="photo-order-header"><h2 id="photoOrderHeading">전체 사진 순서</h2><button id="closePhotoOrder" type="button" aria-label="전체 사진 순서 닫기" autofocus>닫기 ✕</button><p id="photoOrderHint"></p></div><div id="photoOrderList" class="photo-order-list"></div></dialog>`;

export const imageDirectCss = `
.html-editor{display:flow-root;padding-block:18px}
.image-tools{width:min(660px,calc(100vw - 24px));max-width:calc(100vw - 24px);gap:6px;background:#fff;border-color:#cbd4df;padding:8px}
.image-tools button{background:#fff;color:#364357;padding:7px 9px;font-size:12px}.image-tools button:hover{background:#edf3fa}.image-tools #deleteImage{color:#a42929;background:#fff}.image-tools #setSelectedCover{background:#fff;color:#1769d2}.image-tools__label{display:none}
.direct-image-tools{display:flex;align-items:center;flex-wrap:wrap;gap:5px;width:100%;border-bottom:1px solid #e8edf3;padding-bottom:6px}.photo-align-tools{display:flex;gap:1px}.image-tools [data-photo-align][aria-pressed="true"]{background:#e8f1ff;color:#145bac;border-color:#8bb5ee}.direct-image-tools select{width:auto;max-width:145px;padding:6px;font-size:12px}.direct-photo-hint{flex-basis:100%;font-size:11px;line-height:1.5;color:#647184}.image-tools #dragSelectedPhoto{touch-action:none;cursor:grab;color:#175fae}.html-editor img{cursor:grab}.html-editor figcaption{cursor:text}
.photo-number-tools{display:flex;align-items:center;flex-wrap:wrap;gap:5px;font-size:12px}.photo-number-tools input{width:64px;min-height:44px;padding:7px;font-size:16px}.photo-number-tools button{min-height:44px}.photo-number-tools label{font-size:12px}.photo-number-tools #directPhotoNumber{font-weight:600;color:#175fae}.photo-number-overlay{position:fixed;inset:0;z-index:29;pointer-events:none}.photo-number-badge{position:absolute;pointer-events:auto;border:1px solid #fff;border-radius:5px;background:#175fae;color:#fff;padding:6px 9px;font:600 12px/1.4 system-ui;box-shadow:0 1px 5px #0005;min-height:44px;min-width:44px}.photo-number-badge[aria-pressed="true"]{background:#093f80;outline:2px solid #a5c8ff}.photo-number-badge:focus-visible{outline:3px solid #ffbd48}
.photo-order-dialog{width:min(760px,calc(100vw - 24px));max-width:calc(100vw - 24px);max-height:calc(100dvh - 24px);padding:0;border:1px solid #cbd4df;border-radius:10px;color:#364357;background:#fff;overflow:hidden}.photo-order-dialog[open]{display:flex;flex-direction:column}.photo-order-dialog::backdrop{background:#14203399}.photo-order-header{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;padding:16px;border-bottom:1px solid #e8edf3;flex-shrink:0}.photo-order-header h2{font-size:18px;margin:0}.photo-order-header p{flex-basis:100%;font-size:13px;line-height:1.6;margin:0;overflow-wrap:anywhere}.photo-order-header button{min-height:44px;font-size:13px}.photo-order-list{min-height:0;overflow:auto;padding:16px;overscroll-behavior:contain}.photo-order-row{display:flex;align-items:stretch;justify-content:center;gap:8px;padding:10px;margin-bottom:12px;border:1px solid #dbe3ed;border-radius:8px;background:#f5f7fa}.photo-order-row:last-child{margin-bottom:0}.photo-order-choice{flex:1;min-width:0;max-width:220px;display:flex;flex-direction:column;align-items:center;gap:8px;padding:8px;border:2px solid transparent;border-radius:6px;background:#fff;color:#364357;font-size:13px;cursor:pointer}.photo-order-choice:hover{border-color:#8bb5ee}.photo-order-choice:focus-visible{outline:3px solid #ffbd48;outline-offset:1px}.photo-order-choice[data-selected="true"]{border-color:#175fae;background:#e8f1ff}.photo-order-choice img{display:block;width:100%;height:160px;object-fit:contain;background:#edf0f4;pointer-events:none}.photo-order-choice span{min-height:36px;display:flex;align-items:center;justify-content:center;text-align:center;line-height:1.4}.photo-order-row[data-count="2"] .photo-order-choice,.photo-order-row[data-count="3"] .photo-order-choice{max-width:200px}
.photo-drop-indicator{position:fixed;z-index:70;pointer-events:none;background:#1769d2;border-radius:2px;box-shadow:0 0 0 2px #ffffffd9}.photo-drop-indicator span{position:absolute;left:6px;top:7px;white-space:nowrap;border-radius:4px;background:#1769d2;color:#fff;font:12px/1.4 system-ui;padding:4px 7px;box-shadow:0 2px 8px #0002}.photo-drop-indicator[data-mode="group"] span{top:-28px;left:0}.photo-drop-indicator[data-mode="blocked"]{background:#a43434}.photo-drop-indicator[data-mode="blocked"] span{background:#a43434}
.photo-text-hint{position:fixed;z-index:65;pointer-events:none;transform:translateY(-50%);border:1px solid #bfd2ec;border-radius:4px;background:#f5f9ff;color:#285c9a;padding:2px 7px;font:12px/1.4 system-ui;white-space:nowrap}
@media(max-width:480px){.photo-order-header,.photo-order-list{padding:12px}.photo-order-row{padding:6px;gap:4px}.photo-order-choice{padding:4px;font-size:12px}.photo-order-choice img{height:130px}.photo-order-row[data-count="3"] .photo-order-choice img{height:100px}.image-tools{padding:6px;gap:4px}.image-tools button{padding:7px;font-size:11px}.direct-image-tools select{max-width:118px}.direct-photo-hint{font-size:10px}}
`;

export const imageDirectScript = String.raw`
let photoDrag=null,photoScrollFrame=null,photoPointer=null,photoCapture=null;
let photoTextPointer=null;
let photoNumberFrame=null,photoNumberSelection=null,photoNumberIndex=-1,photoNumberCount=0;
let photoOrderOwner=null,photoOrderSource=null,photoOrderSnapshot=[],photoOrderFocusInput=false;
function directBodyPhotos(){return Array.from($('bodyHtml').querySelectorAll('img')).filter(image=>!image.closest('[data-ke-type="opengraph"],.se_component.se_oglink,.se-component.se-oglink'))}
function updateDirectPhotoNumberControls(){
  const images=directBodyPhotos(),image=selectedMedia?.image,index=images.indexOf(image),input=$('directPhotoPosition');
  $('directPhotoNumber').textContent=index<0?'':'사진 '+(index+1)+' / '+images.length;
  input.max=String(images.length);input.disabled=busy||index<0||images.length<2;$('movePhotoByNumber').disabled=input.disabled;$('openPhotoOrder').disabled=busy||index<0;
  if(photoNumberSelection!==image||photoNumberIndex!==index||photoNumberCount!==images.length)input.value=index<0?'':String(index+1);
  photoNumberSelection=image;photoNumberIndex=index;photoNumberCount=images.length;
}
function refreshDirectPhotoNumbers(){
  photoNumberFrame=null;const overlay=$('photoNumberOverlay'),body=$('bodyHtml'),bounds=body.getBoundingClientRect(),images=directBodyPhotos();overlay.replaceChildren();
  const top=Math.max(0,$('editorHeader').getBoundingClientRect().bottom,bounds.top),bottom=Math.min(window.innerHeight,$('editorFooter').hidden?window.innerHeight:$('editorFooter').getBoundingClientRect().top,bounds.bottom);
  if(current&&bounds.width>0&&bounds.height>0&&!photoDrag)images.forEach((image,index)=>{
    const box=image.getBoundingClientRect();if(box.width<=0||box.height<=0||box.bottom<=top||box.top>=bottom||box.right<=0||box.left>=window.innerWidth)return;
    const badge=document.createElement('button');badge.type='button';badge.className='photo-number-badge';badge.textContent=String(index+1);badge.setAttribute('aria-label','사진 '+(index+1)+' 선택');badge.setAttribute('aria-pressed',String(selectedMedia?.image===image));badge.disabled=busy;
    badge.style.left=Math.max(4,box.left+6)+'px';badge.style.top=Math.max(top+4,box.top+6)+'px';badge.addEventListener('mousedown',event=>event.preventDefault());badge.addEventListener('click',event=>{event.stopPropagation();if(!busy&&body.contains(image))selectMedia(image)});overlay.append(badge);
  });
  updateDirectPhotoNumberControls();refreshDirectPhotoOrder();
}
function scheduleDirectPhotoNumbers(){if(photoNumberFrame===null&&typeof window.requestAnimationFrame==='function')photoNumberFrame=window.requestAnimationFrame(refreshDirectPhotoNumbers)}
function refreshDirectPhotoOrder(){
  const dialog=$('photoOrderDialog');if(!dialog.open)return;
  const images=directBodyPhotos(),from=images.indexOf(photoOrderSource);
  if(!current||current.id!==photoOrderOwner||from<0||selectedMedia?.image!==photoOrderSource){dialog.close();return}
  $('photoOrderHint').textContent='옮길 사진: '+(from+1)+'번 / 전체 '+images.length+'장. 원하는 최종 번호의 사진을 누르면 옮길 번호가 채워집니다. 이동은 번호로 이동 버튼을 눌러 실행합니다. 함께 놓인 사진은 같은 줄로 표시합니다.';
  const snapshot=images.map(image=>({image,src:image.currentSrc||image.getAttribute('src')||'',alt:image.getAttribute('alt')||'',group:image.closest('.dwnc-image-layout')}));
  const changed=snapshot.length!==photoOrderSnapshot.length||snapshot.some((item,index)=>Object.keys(item).some(key=>item[key]!==photoOrderSnapshot[index]?.[key]));
  if(!changed){for(const button of $('photoOrderList').querySelectorAll('button'))button.disabled=busy;return}
  const focusedIndex=Array.from($('photoOrderList').querySelectorAll('button')).indexOf(document.activeElement),focusedImage=photoOrderSnapshot[focusedIndex]?.image;
  photoOrderSnapshot=snapshot;const list=$('photoOrderList');list.replaceChildren();let row=null,previous=null;
  snapshot.forEach((item,index)=>{
    if(!row||!item.group||item.group!==previous){row=document.createElement('div');row.className='photo-order-row';list.append(row)}
    previous=item.group;const button=document.createElement('button'),preview=document.createElement('img'),label=document.createElement('span');
    button.type='button';button.className='photo-order-choice';button.dataset.selected=String(item.image===photoOrderSource);button.disabled=busy;button.setAttribute('aria-label','사진 '+(index+1)+'번 위치 선택'+(item.image===photoOrderSource?' · 옮길 사진':''));
    preview.setAttribute('src',item.src);preview.setAttribute('alt',item.alt);preview.setAttribute('loading','lazy');preview.setAttribute('decoding','async');preview.draggable=false;
    label.textContent=(index+1)+'번'+(item.image===photoOrderSource?' · 옮길 사진':'');button.append(preview,label);row.append(button);row.dataset.count=String(row.children.length);
    button.addEventListener('click',()=>chooseDirectPhotoOrder(item.image));if(item.image===focusedImage)button.focus({preventScroll:true});
  });
}
function openDirectPhotoOrder(){
  if(busy||!current||!directBodyPhotos().includes(selectedMedia?.image))return;
  photoOrderOwner=current.id;photoOrderSource=selectedMedia.image;photoOrderSnapshot=[];photoOrderFocusInput=false;
  $('photoOrderDialog').showModal();refreshDirectPhotoOrder();
}
function chooseDirectPhotoOrder(image){
  const images=directBodyPhotos(),index=images.indexOf(image);
  if(busy||current?.id!==photoOrderOwner||selectedMedia?.image!==photoOrderSource||!images.includes(photoOrderSource)||index<0){refreshDirectPhotoOrder();return}
  updateDirectPhotoNumberControls();$('directPhotoPosition').value=String(index+1);photoOrderFocusInput=true;$('photoOrderDialog').close();
  status('옮길 번호를 '+(index+1)+'번으로 선택했습니다. 번호로 이동을 누르면 사진이 이동합니다.');
}
function moveDirectPhotoByNumber(){
  const images=directBodyPhotos(),image=selectedMedia?.image,from=images.indexOf(image),value=$('directPhotoPosition').value,to=Number(value);
  if(busy||!current||editorComposing||from<0)return false;
  if(!value.trim()||!Number.isInteger(to)||to<1||to>images.length){status('옮길 번호는 1부터 '+images.length+' 사이의 정수로 입력해 주세요.');$('directPhotoPosition').focus();return false}
  if(to===from+1){status('이미 사진 '+to+'번 위치입니다.');return false}
  const anchor=images[to-1],source=directPhotoUnit(image),destination=directPhotoUnit(anchor),side=to<from+1?'before':'after';
  if(!source||!destination){status('이 사진의 기존 배치를 번호로 옮길 수 없습니다. 본문은 유지했습니다.');return false}
  let target;
  if(source.group&&source.group===destination.group)target={type:'group',image:anchor,side};
  else if(destination.group){
    const items=imageLayoutItems(destination.group),at=items.indexOf(destination.item)+(side==='after'?1:0);
    target={type:'move',parent:destination.group.parentNode,before:at===0?destination.group:destination.group.nextSibling};
    if(at>0&&at<items.length)target.split={group:destination.group,items:items.slice(at)};
  }else{
    const block=directBodyBlock(anchor),photos=images.filter(photo=>block?.contains(photo)&&photo!==image);
    if(!block||(side==='before'?photos[0]!==anchor:photos.at(-1)!==anchor)){status('글이나 표 안에 함께 있는 사진 사이로는 번호 이동을 할 수 없습니다. 사진을 별도 문단으로 분리해 주세요.');return false}
    target={type:'move',parent:block.parentNode,before:side==='before'?block:block.nextSibling};
  }
  if(!moveDirectPhoto(image,target))return false;
  updateDirectPhotoNumberControls();scheduleDirectPhotoNumbers();status('사진 '+(from+1)+'번을 '+to+'번 위치로 옮겼습니다. 실행 취소할 수 있으며 작업본에 자동저장됩니다.');return true;
}
function emptyPhotoParagraph(node){return!!node&&node.tagName==='P'&&!node.textContent.replace(/[\s\u200b]/g,'')&&!node.querySelector('img,video,audio,iframe,table,hr,input,button,svg,canvas')}
function photoTextBlock(node){const image=node?.matches('img')?node:node?.querySelector('img'),unit=directPhotoUnit(image);return!!unit&&unit.root===node}
function directPhotoTextTarget(x,y,hit){
  const body=$('bodyHtml');
  if(busy||!current||editorComposing||photoDrag||!hit||!body.contains(hit))return null;
  // Only outer whitespace is a target. Captions, group gutters and inline
  // images remain part of their existing editable/selectable content.
  if(hit.closest('figure,.dwnc-image-layout,.dwnc-image-item,figcaption,img,a,table,ul,ol,blockquote,pre,h1,h2,h3,h4,h5,h6'))return null;
  const paragraph=hit.closest('p');
  if(paragraph&&!emptyPhotoParagraph(paragraph))return null;
  const parent=paragraph?paragraph.parentElement:hit;
  if(parent!==body&&!parent.matches('div,section,article'))return null;
  if(parent.closest('[contenteditable="false"],.se_component.se_image,.se-component.se-image,[data-ke-type="opengraph"],.se_component.se_oglink,.se-component.se-oglink'))return null;
  if(Array.from(parent.childNodes).some(node=>node.nodeType===3&&node.textContent.trim()))return null;
  const bounds=parent.getBoundingClientRect();
  if(x<bounds.left||x>bounds.right||y<bounds.top||y>bounds.bottom)return null;
  const blocks=Array.from(parent.children).filter(node=>node.getBoundingClientRect().height>0);
  let before=null,previous=null,reuse=paragraph;
  if(paragraph){const index=blocks.indexOf(paragraph);previous=blocks[index-1]||null;before=blocks[index+1]||null}
  else{
    for(const block of blocks){const box=block.getBoundingClientRect();if(y>=box.top&&y<=box.bottom)return null;if(box.bottom<y)previous=block;else if(box.top>y){before=block;break}}
    if(emptyPhotoParagraph(previous))reuse=previous;
    else if(emptyPhotoParagraph(before))reuse=before;
    if(reuse){const index=blocks.indexOf(reuse);previous=blocks[index-1]||null;before=blocks[index+1]||null}
  }
  if(!photoTextBlock(previous)&&!photoTextBlock(before))return null;
  // At an outer edge, only offer the nearby margin, never a whole empty page.
  const top=previous?.getBoundingClientRect().bottom??bounds.top,bottom=before?.getBoundingClientRect().top??bounds.bottom;
  if(!reuse&&(y-top>40&&bottom-y>40))return null;
  const hintTop=reuse?reuse.getBoundingClientRect().top+reuse.getBoundingClientRect().height/2:!before?top+Math.min(16,(bottom-top)/2):!previous?bottom-Math.min(16,(bottom-top)/2):(top+bottom)/2;
  return{parent,before,paragraph:reuse,left:bounds.left+8,top:hintTop};
}
function enterPhotoText(target){
  const body=$('bodyHtml');if(!target||busy||!current||editorComposing||photoDrag||!body.contains(target.parent))return false;
  let paragraph=target.paragraph;
  if(paragraph&&(!body.contains(paragraph)||!emptyPhotoParagraph(paragraph)))return false;
  if(!paragraph){
    if(target.before&&target.before.parentNode!==target.parent)return false;
    commitEditorHistory();captureEditorBefore();editorTyping=null;
    paragraph=document.createElement('p');paragraph.append(document.createElement('br'));target.parent.insertBefore(paragraph,target.before);
  }
  clearMediaSelection();uploadRange=null;formatRange=null;pendingFontSpans=null;pastedImageNodes=null;
  body.focus({preventScroll:true});const range=document.createRange();range.selectNodeContents(paragraph);range.collapse(true);const selection=window.getSelection();selection.removeAllRanges();selection.addRange(range);captureFormatRange();updateFormatState();
  $('photoTextHint').hidden=true;
  if(!target.paragraph){schedule();status('선택한 사진 앞뒤 위치에 글을 쓸 수 있습니다. 작업본에 자동저장됩니다.')}
  return true;
}
function hidePhotoTextHint(){ $('photoTextHint').hidden=true }
$('bodyHtml').addEventListener('pointerdown',event=>{photoTextPointer=event.button===0&&!event.shiftKey&&!event.ctrlKey&&!event.metaKey&&!event.altKey?{x:event.clientX,y:event.clientY,target:directPhotoTextTarget(event.clientX,event.clientY,event.target instanceof Element?event.target:null)}:null});
$('bodyHtml').addEventListener('pointermove',event=>{
  if(photoTextPointer&&Math.hypot(event.clientX-photoTextPointer.x,event.clientY-photoTextPointer.y)>6)photoTextPointer=null;
  const target=event.buttons?null:directPhotoTextTarget(event.clientX,event.clientY,event.target instanceof Element?event.target:null),hint=$('photoTextHint');hint.hidden=!target;if(target){hint.style.left=target.left+'px';hint.style.top=target.top+'px'}
});
$('bodyHtml').addEventListener('click',event=>{const pointer=photoTextPointer;photoTextPointer=null;hidePhotoTextHint();if(!pointer?.target||event.button!==0||Math.hypot(event.clientX-pointer.x,event.clientY-pointer.y)>6)return;const target=directPhotoTextTarget(event.clientX,event.clientY,event.target instanceof Element?event.target:null);if(target&&enterPhotoText(target)){event.preventDefault();event.stopImmediatePropagation()}},true);
$('bodyHtml').addEventListener('pointercancel',()=>{photoTextPointer=null;hidePhotoTextHint()});
$('bodyHtml').addEventListener('pointerleave',hidePhotoTextHint);
$('bodyHtml').addEventListener('input',hidePhotoTextHint);
window.addEventListener('scroll',hidePhotoTextHint,true);
window.addEventListener('resize',hidePhotoTextHint);
function directPhotoUnit(image){
  const body=$('bodyHtml');
  if(!image||!body.contains(image)||image.tagName!=='IMG'||image.closest('[data-ke-type="opengraph"],.se_component.se_oglink,.se-component.se-oglink'))return null;
  const group=image.closest('.dwnc-image-layout');
  if(group){const items=imageLayoutItems(group),item=image.closest('.dwnc-image-item');if(!item||item.parentElement!==group||Array.from(group.children).some(node=>!node.matches('.dwnc-image-item,.dwnc-image-caption'))||items.some(node=>!node.matches('.dwnc-image-item')||node.querySelectorAll('img').length!==1))return null;return{image,group,item,root:group}}
  return{image,group:null,item:null,root:layoutRoot(image)};
}
function directLayoutValue(group,values,fallback){return values.find(value=>group?.classList.contains('dwnc-image-'+value))||fallback}
function directLayoutSupported(unit){return!!unit&&(!!unit.group||!unit.root.parentElement?.closest('p,h1,h2,h3,h4,h5,h6,span,a,em,strong,b,i,u,s'))}
function normalizeDirectLayout(group){
  const images=normalizeImageGroupStructure(group);if(!images)return;
  const columns=images.length;
  const size=directLayoutValue(group,['original','paragraph','full'],'original');
  if(size!=='original'&&!layoutSizeAvailability(images,columns)[size]){group.classList.remove('dwnc-image-paragraph','dwnc-image-full');group.classList.add('dwnc-image-original')}
  group.style.setProperty('--dwnc-original-layout-width',Math.max(1,Math.min(1200,Math.max(0,...images.map(image=>image.naturalWidth))*columns+12*(columns-1)))+'px');
  refreshImageGroupGeometry(group,images);
  for(const image of images){if(!image.hasAttribute('data-dwnc-original-width'))image.setAttribute('data-dwnc-original-width','none');image.style.setProperty('width',image.naturalWidth>0?image.naturalWidth+'px':'auto','important')}
}
function ensureDirectLayout(unit){
  if(unit.group)return unit.group;
  const group=document.createElement('div'),item=document.createElement('div');group.className='dwnc-image-layout dwnc-image-center dwnc-image-original';item.className='dwnc-image-item';
  unit.root.before(group);item.append(unit.root);group.append(prepareLayoutItem(item));normalizeDirectLayout(group);return group;
}
function finishDirectPhotoChange(image,message){
  uploadRange=null;formatRange=null;pendingFontSpans=null;pastedImageNodes=null;
  selectMedia(image);captureFormatRange();schedule();status(message+' 실행 취소할 수 있으며 작업본에 자동저장됩니다.');
}
function moveDirectPhoto(image,target){
  const source=directPhotoUnit(image),body=$('bodyHtml');
  if(busy||!current||!source||!target||target.type==='blocked')return false;
  if(target.type==='group'){
    const destination=directPhotoUnit(target.image);
    if(!destination||image===target.image||source.root.contains(destination.root)&&source.group!==destination.group)return false;
    if(!directLayoutSupported(destination)){status('글자와 함께 있는 사진은 먼저 문단 사이로 끌어 놓은 뒤 묶어 주세요. 본문과 서식은 유지했습니다.');return false}
    const same=!!source.group&&source.group===destination.group,count=destination.group?imageLayoutItems(destination.group).length:1;
    if(!same&&count>=3){status('한 줄에는 사진을 3장까지 놓을 수 있습니다. 문단 사이로 끌면 한 장씩 놓습니다.');return false}
    if(same&&(target.side==='before'?source.item.nextElementSibling===destination.item:destination.item.nextElementSibling===source.item))return false;
    commitEditorHistory();captureEditorBefore();editorTyping=null;
    const old=source.group,group=ensureDirectLayout(destination);if(old)normalizeImageGroupCaption(old);normalizeImageGroupCaption(group);let item=source.item;
    if(!item){item=document.createElement('div');item.className='dwnc-image-item';item.append(source.root);prepareLayoutItem(item)}
    const next=target.side==='before'?directPhotoUnit(target.image).item:directPhotoUnit(target.image).item.nextSibling;
    group.insertBefore(item,next);if(old&&old!==group){if(!imageLayoutItems(old).length&&imageLayoutCaption(old)){const from=imageLayoutCaption(old),to=imageLayoutCaption(group);if(to){appendImageCaptionPart(to,from);from.remove()}else group.append(from)}normalizeDirectLayout(old);}normalizeDirectLayout(group);
    finishDirectPhotoChange(image,same?'사진 순서를 바꿨습니다.':'사진을 한 줄로 묶었습니다.');return true;
  }
  const parent=target.parent;let before=target.before||null;
  if(!parent||(parent!==body&&!body.contains(parent))||before&&before.parentNode!==parent||source.root.contains(parent))return false;
  if(!target.split&&(!source.group||imageLayoutItems(source.group).length===1)){if(before===source.root||source.root.parentNode===parent&&source.root.nextSibling===before)return false}
  commitEditorHistory();captureEditorBefore();editorTyping=null;
  // A numbered destination inside another row needs a boundary between cells.
  // Split and move in one history entry; the shared caption stays on the first row.
  if(target.split){
    const original=target.split.group,trailing=document.createElement('div');normalizeImageGroupCaption(original);trailing.className=original.className;
    for(const attr of ['style','lang','dir','align'])if(original.getAttribute(attr))trailing.setAttribute(attr,original.getAttribute(attr));
    trailing.append(...target.split.items);parent.insertBefore(trailing,original.nextSibling);normalizeDirectLayout(original);normalizeDirectLayout(trailing);before=trailing;
  }
  if(source.group&&imageLayoutItems(source.group).length>1){
    normalizeImageGroupCaption(source.group);
    const group=document.createElement('div');group.className='dwnc-image-layout dwnc-image-'+directLayoutValue(source.group,['left','center','right'],'center')+' dwnc-image-original';group.append(source.item);parent.insertBefore(group,before);normalizeDirectLayout(source.group);normalizeDirectLayout(group);
  }else parent.insertBefore(source.root,before);
  finishDirectPhotoChange(image,source.group?'사진을 옮겼습니다.':'사진과 설명을 함께 옮겼습니다.');return true;
}
function updateDirectPhotoTools(){
  const unit=directPhotoUnit(selectedMedia?.image),tools=$('directImageTools');tools.hidden=!unit;updateDirectPhotoNumberControls();scheduleDirectPhotoNumbers();
  if(!unit)return;
  const images=unit.group?Array.from(unit.group.querySelectorAll('img')):[unit.image],columns=images.length,available=layoutSizeAvailability(images,columns),align=directLayoutValue(unit.group,['left','center','right'],'center'),size=directLayoutValue(unit.group,['original','paragraph','full'],'original');
  const supported=directLayoutSupported(unit);
  for(const button of tools.querySelectorAll('[data-photo-align]')){button.setAttribute('aria-pressed',String(button.dataset.photoAlign===align));button.disabled=!supported}
  const select=$('directPhotoSize');select.value=size;select.disabled=!supported;
  for(const option of select.options){option.disabled=option.value!=='original'&&!available[option.value];option.title=option.disabled?'원본 너비가 부족하거나 아직 확인되지 않아 확대 없이 채울 수 없습니다.':''}
  $('splitSelectedPhoto').hidden=columns<2;
  $('directPhotoHint').textContent=!supported?'글자와 함께 있는 사진은 문단 사이로 끌어 놓은 뒤 정렬·크기를 바꿀 수 있습니다.':(columns>1?'이 줄의 '+columns+'장에 설명·정렬·크기가 함께 적용됩니다. ':'')+(available.full?'사진을 끌어 이동 · 사진 옆에 놓아 묶기':available.paragraph?'전체 폭은 원본 너비가 부족해 선택할 수 없습니다.':'원본을 확대하지 않습니다. 작은 사진이나 크기 미확인 사진은 100%만 선택할 수 있습니다.');
}
function setDirectPhotoLayout(property,value){
  const unit=directPhotoUnit(selectedMedia?.image);if(busy||!current||!unit)return;
  if(!directLayoutSupported(unit)){status('글자와 함께 있는 사진은 먼저 문단 사이로 끌어 놓아 주세요. 본문과 서식은 유지했습니다.');return}
  const images=unit.group?Array.from(unit.group.querySelectorAll('img')):[unit.image];
  if(property==='size'&&value!=='original'&&!layoutSizeAvailability(images,images.length)[value]){updateDirectPhotoTools();status('원본을 확대하지 않고 채울 수 있는 크기만 선택할 수 있습니다.');return}
  commitEditorHistory();captureEditorBefore();editorTyping=null;const group=ensureDirectLayout(unit),values=property==='align'?['left','center','right']:['original','paragraph','full'];
  group.classList.remove(...values.map(item=>'dwnc-image-'+item));group.classList.add('dwnc-image-'+value);normalizeDirectLayout(group);finishDirectPhotoChange(unit.image,'사진 '+(property==='align'?'정렬':'크기')+'를 바꿨습니다.');
}
function directBodyBlock(element){
  const body=$('bodyHtml');if(!element||element===body||!body.contains(element))return null;
  const group=element.closest('.dwnc-image-layout');if(group)return group;
  const container=element.closest('table,ul,ol,blockquote');if(container&&body.contains(container))return container;
  let node=element.closest('p,h1,h2,h3,h4,h5,h6,figure,pre,hr,div');
  if(!node||node===body){node=element;while(node.parentElement&&node.parentElement!==body)node=node.parentElement}
  return node===body?null:node;
}
function directPhotoDropTarget(x,y,image){
  const body=$('bodyHtml'),source=directPhotoUnit(image),hit=document.elementFromPoint(x,y),bounds=body.getBoundingClientRect();
  if(!source||!hit||!body.contains(hit))return null;
  const other=hit.closest('img'),unit=directPhotoUnit(other);
  if(unit&&other!==image){
    const box=other.getBoundingClientRect();
    if(y>box.top+Math.min(32,box.height*.24)&&y<box.bottom-Math.min(32,box.height*.24)){
      const side=x<box.left+box.width/2?'before':'after',full=unit.group&&unit.group!==source.group&&imageLayoutItems(unit.group).length>=3,supported=directLayoutSupported(unit);
      return{type:full||!supported?'blocked':'group',image:other,side,left:side==='before'?box.left:box.right,top:box.top,width:3,height:box.height,label:!supported?'글자 속 사진을 먼저 문단 밖으로 이동':full?'한 줄에 최대 3장':unit.group&&unit.group===source.group?'여기로 순서 변경':'옆에 놓아 함께 묶기'};
    }
  }
  let block=directBodyBlock(hit);
  if(!block){
    const blocks=Array.from(body.children).filter(node=>node.getBoundingClientRect().height>0);
    block=blocks.reduce((best,node)=>{const box=node.getBoundingClientRect(),distance=Math.min(Math.abs(y-box.top),Math.abs(y-box.bottom));return!best||distance<best.distance?{node,distance}:best},null)?.node;
  }
  if(!block)return{type:'move',parent:body,before:null,left:bounds.left,top:bounds.top,width:bounds.width,height:3,label:'여기에 사진 놓기'};
  const box=block.getBoundingClientRect(),before=y<box.top+box.height/2;
  return{type:'move',parent:block.parentNode,before:before?block:block.nextSibling,left:Math.max(bounds.left,box.left),top:before?box.top-5:box.bottom+5,width:Math.min(bounds.width,box.width||bounds.width),height:3,label:source.group&&imageLayoutItems(source.group).length>1?'여기로 빼내어 한 장씩 놓기':'이 문단 사이로 이동'};
}
function showDirectPhotoDrop(x,y){
  if(!photoDrag)return;photoDrag.x=x;photoDrag.y=y;photoDrag.target=directPhotoDropTarget(x,y,photoDrag.image);
  const indicator=$('photoDropIndicator'),target=photoDrag.target;indicator.hidden=!target;if(!target)return;
  indicator.dataset.mode=target.type;indicator.style.left=target.left+'px';indicator.style.top=target.top+'px';indicator.style.width=target.width+'px';indicator.style.height=target.height+'px';$('photoDropLabel').textContent=target.label;
}
function stopDirectPhotoDrag(){scheduleDirectPhotoNumbers();if(photoCapture&&photoCapture.hasPointerCapture(photoPointer))photoCapture.releasePointerCapture(photoPointer);photoCapture=null;photoDrag=null;photoPointer=null;$('photoDropIndicator').hidden=true;if(photoScrollFrame!==null){window.cancelAnimationFrame(photoScrollFrame);photoScrollFrame=null}}
function scrollDirectPhotoDrag(){
  if(!photoDrag)return;const top=$('editorHeader').getBoundingClientRect().bottom+45,bottom=$('editorFooter').getBoundingClientRect().top-45,y=photoDrag.y;
  if(y<top||y>bottom){window.scrollBy(0,y<top?-12:12);showDirectPhotoDrop(photoDrag.x,y)}
  photoScrollFrame=window.requestAnimationFrame(scrollDirectPhotoDrag);
}
function startDirectPhotoDrag(image,hideTools=true){if(busy||!current||editorComposing||!directPhotoUnit(image))return false;stopDirectPhotoDrag();hidePhotoTextHint();selectMedia(image);photoDrag={image,owner:current.id,target:null,x:0,y:window.innerHeight/2};$('photoNumberOverlay').replaceChildren();if(hideTools)$('imageTools').hidden=true;status('문단 사이 가로선에 놓으면 이동·분리, 사진 옆 세로선에 놓으면 묶기·순서 변경');photoScrollFrame=window.requestAnimationFrame(scrollDirectPhotoDrag);return true}
function finishDirectPhotoDrop(){const drag=photoDrag;stopDirectPhotoDrag();if(drag?.owner===current?.id&&$('bodyHtml').contains(drag.image)){if(!moveDirectPhoto(drag.image,drag.target)){selectMedia(drag.image);status(drag.target?.type==='blocked'?drag.target.label:'사진 위치를 바꾸지 않았습니다.')}}}
$('bodyHtml').addEventListener('dragstart',event=>{const image=event.target instanceof Element?event.target.closest('img'):null;if(!startDirectPhotoDrag(image))return;event.stopPropagation();event.dataTransfer.effectAllowed='move';event.dataTransfer.clearData();event.dataTransfer.setData('text/plain','');event.dataTransfer.setData('application/x-dwnc-photo','photo')});
document.addEventListener('dragover',event=>{if(!photoDrag)return;event.preventDefault();showDirectPhotoDrop(event.clientX,event.clientY);if(event.dataTransfer)event.dataTransfer.dropEffect=photoDrag.target&&photoDrag.target.type!=='blocked'?'move':'none'});
document.addEventListener('drop',event=>{if(!photoDrag)return;event.preventDefault();event.stopPropagation();showDirectPhotoDrop(event.clientX,event.clientY);finishDirectPhotoDrop()},true);
document.addEventListener('dragend',()=>{if(photoDrag){const image=photoDrag.image;stopDirectPhotoDrag();if($('bodyHtml').contains(image))selectMedia(image)}});
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&photoDrag){event.preventDefault();stopDirectPhotoDrag();clearMediaSelection()}});
$('dragSelectedPhoto').addEventListener('pointerdown',event=>{const image=selectedMedia?.image;if(event.button!==0||!startDirectPhotoDrag(image,false))return;event.preventDefault();photoPointer=event.pointerId;photoCapture=event.currentTarget;photoCapture.setPointerCapture(event.pointerId);$('imageTools').hidden=true;showDirectPhotoDrop(event.clientX,event.clientY)});
document.addEventListener('pointermove',event=>{if(photoDrag&&photoPointer===event.pointerId){event.preventDefault();showDirectPhotoDrop(event.clientX,event.clientY)}},{passive:false});
document.addEventListener('pointerup',event=>{if(photoDrag&&photoPointer===event.pointerId){event.preventDefault();showDirectPhotoDrop(event.clientX,event.clientY);finishDirectPhotoDrop()}});
document.addEventListener('pointercancel',()=>{if(photoPointer!==null){const image=photoDrag?.image;stopDirectPhotoDrag();if(image&&$('bodyHtml').contains(image))selectMedia(image)}});
$('dragSelectedPhoto').addEventListener('keydown',event=>{if(!['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(event.key))return;const unit=directPhotoUnit(selectedMedia?.image);if(!unit)return;event.preventDefault();const previous=event.key==='ArrowUp'||event.key==='ArrowLeft',sibling=previous?unit.root.previousElementSibling:unit.root.nextElementSibling;if((event.key==='ArrowLeft'||event.key==='ArrowRight')&&unit.group){const item=previous?unit.item.previousElementSibling:unit.item.nextElementSibling;if(item)moveDirectPhoto(unit.image,{type:'group',image:item.querySelector('img'),side:previous?'before':'after'})}else if(sibling)moveDirectPhoto(unit.image,{type:'move',parent:unit.root.parentNode,before:previous?sibling:sibling.nextSibling});$('dragSelectedPhoto').focus({preventScroll:true})});
for(const button of $('directImageTools').querySelectorAll('[data-photo-align]'))button.addEventListener('click',()=>setDirectPhotoLayout('align',button.dataset.photoAlign));
$('directPhotoSize').addEventListener('change',()=>setDirectPhotoLayout('size',$('directPhotoSize').value));
$('splitSelectedPhoto').addEventListener('click',()=>{const unit=directPhotoUnit(selectedMedia?.image);if(unit?.group)moveDirectPhoto(unit.image,{type:'move',parent:unit.group.parentNode,before:unit.group.nextSibling})});
$('openPhotoOrder').addEventListener('click',openDirectPhotoOrder);
$('closePhotoOrder').addEventListener('click',()=>$('photoOrderDialog').close());
$('photoOrderDialog').addEventListener('close',()=>{const input=photoOrderFocusInput;photoOrderOwner=null;photoOrderSource=null;photoOrderSnapshot=[];photoOrderFocusInput=false;if(selectedMedia?.image&&$('bodyHtml').contains(selectedMedia.image)&&current)(input?$('directPhotoPosition'):$('openPhotoOrder')).focus({preventScroll:true})});
$('movePhotoByNumber').addEventListener('click',moveDirectPhotoByNumber);
$('directPhotoPosition').addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();moveDirectPhotoByNumber()}});
$('bodyHtml').addEventListener('scroll',scheduleDirectPhotoNumbers);
document.addEventListener('input',scheduleDirectPhotoNumbers);
window.addEventListener('scroll',scheduleDirectPhotoNumbers,true);window.addEventListener('resize',scheduleDirectPhotoNumbers);
if(typeof MutationObserver!=='undefined'){
  const photoNumberObserver=new MutationObserver(scheduleDirectPhotoNumbers);photoNumberObserver.observe($('bodyHtml'),{childList:true,subtree:true,attributes:true,attributeFilter:['src','srcset','alt','class']});
  const viewObserver=new MutationObserver(scheduleDirectPhotoNumbers);viewObserver.observe(document.body,{attributes:true,attributeFilter:['data-view']});
}
$('bodyHtml').addEventListener('load',event=>{const group=event.target.closest?.('.dwnc-image-layout');if(group)refreshImageGroupGeometry(group);updateDirectPhotoTools();positionMediaSelection();scheduleDirectPhotoNumbers()},true);
scheduleDirectPhotoNumbers();
`;
