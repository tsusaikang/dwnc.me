import { canonicalPhotoSource, formatPhotoBytes } from './photo-media-summary.ts';

// Detached controls preserve the article's groups, links and captions. Basic
// values use the page's metadata; detailed file reads happen only on interaction.
export const PUBLIC_PHOTO_INFO_BOOTSTRAP = '(function(){\nconst canonicalPhotoSource=' + canonicalPhotoSource.toString() + ';\nconst formatPhotoBytes=' + formatPhotoBytes.toString() + ';\n' + String.raw`
const body=document.querySelector('.article-page .prose');
if(!body||document.getElementById('publicPhotoInfoPopover'))return;
const photos=Array.from(body.querySelectorAll('img[src]')).filter(image=>!image.closest('[data-ke-type="opengraph"],.se_component.se_oglink,.se-component.se-oglink'));
if(!photos.length)return;
const files=new Map();
try{const seed=JSON.parse(document.getElementById('publicPhotoMetadata')?.textContent||'[]');for(const file of Array.isArray(seed)?seed:[]){if(typeof file?.path==='string')files.set(canonicalPhotoSource(file.path),file)}}catch{}
const layer=document.createElement('div');layer.className='public-photo-info-controls';
const popover=document.createElement('section');popover.id='publicPhotoInfoPopover';popover.className='public-photo-info-popover';popover.hidden=true;popover.setAttribute('aria-labelledby','publicPhotoInfoTitle');
popover.innerHTML='<div class="public-photo-info-popover__header"><h2 id="publicPhotoInfoTitle">사진 정보</h2><button type="button" data-photo-info-close aria-label="사진 정보 닫기">×</button></div><div data-photo-info-content aria-live="polite"></div>';
document.body.append(layer);layer.append(popover);
const title=popover.querySelector('h2'),content=popover.querySelector('[data-photo-info-content]');
let active=null,reason='',requestVersion=0,frame=0,hoverTimer=null,closeTimer=null;
const cache=new Map(),positive=value=>Number.isSafeInteger(value)&&value>0;
function sourcePath(image){
  let source=image.getAttribute('src')||'';
  try{const url=new URL(source,location.href);if(/^https?:\/\//i.test(source)&&url.origin===location.origin){url.protocol='https:';url.host='dwnc.me';url.port='';source=url.href}}catch{}
  const path=canonicalPhotoSource(source);return path.startsWith('/media/')?path:null;
}
function basicInfo(image,compact=false){
  const path=sourcePath(image),file=path?files.get(path):null,vector=file?.mime==='image/svg+xml'||/\.svg(?:[?#]|$)/i.test(image.getAttribute('src')||'');
  const dimensions=vector?'벡터 이미지':positive(image.naturalWidth)&&positive(image.naturalHeight)?image.naturalWidth+(compact?'×':' × ')+image.naturalHeight+(compact?'':' px'):'해상도 미확인';
  return{dimensions,size:positive(file?.bytes)?formatPhotoBytes(file.bytes):'용량 미확인'};
}
function message(text){content.replaceChildren();const paragraph=document.createElement('p');paragraph.textContent=text;content.append(paragraph);positionPopover()}
function renderInfo(info,image){
  content.replaceChildren();const list=document.createElement('dl');
  function row(label,value){const name=document.createElement('dt'),detail=document.createElement('dd');name.textContent=label;detail.textContent=value;list.append(name,detail)}
  const dimensions=positive(info.width)&&positive(info.height)?[info.width,info.height]:image.complete&&positive(image.naturalWidth)&&positive(image.naturalHeight)?[image.naturalWidth,image.naturalHeight]:null;
  row('해상도',String(info.format||'').toUpperCase()==='SVG'?'벡터 이미지':dimensions?dimensions[0]+' × '+dimensions[1]+' px':'미확인');
  row('저장 용량',positive(info.bytes)?formatPhotoBytes(info.bytes)+' ('+info.bytes.toLocaleString('ko-KR')+' 바이트)':'미확인');
  row('파일 형식',info.format||'미확인');row('색영역',info.colorSpace||'미확인');
  if(info.profileName&&info.profileName!==info.colorSpace)row('색상 프로필',info.profileName);
  row('HDR 정보',info.hdr==='metadata-present'?'HDR 메타데이터 있음':info.hdr==='not-indicated'?'HDR 표시 없음':'미확인');
  content.append(list);
  if(info.hdr!=='unknown'){const note=document.createElement('p');note.className='public-photo-info-popover__note';note.textContent='파일 정보만으로 실제 HDR 지원 여부를 확정할 수 없습니다.';content.append(note)}
  positionPopover();
}
function closeInfo(restoreFocus=false){
  clearTimeout(hoverTimer);clearTimeout(closeTimer);requestVersion++;const button=active?.button;
  if(button){button.setAttribute('aria-expanded','false');active.card.setAttribute('data-expanded','false')}active=null;reason='';popover.hidden=true;layer.append(popover);position();
  if(restoreFocus&&button?.isConnected){button.suppressPhotoFocus=true;button.focus({preventScroll:true});button.suppressPhotoFocus=false}
}
function positionPopover(){
  if(!active||popover.hidden)return;
  const {image,button,card}=active,rect=image.getBoundingClientRect(),viewportWidth=window.innerWidth,viewportHeight=window.innerHeight;
  const summaryHeight=button.offsetHeight||44,summaryWidth=button.offsetWidth||Math.min(140,Math.max(44,rect.width-8)),small=rect.height<128;
  const anchorTop=small?rect.top-summaryHeight:rect.top+4;
  if(!image.isConnected||anchorTop+summaryHeight<=0||anchorTop>=viewportHeight){closeInfo();return}
  const width=Math.min(300,viewportWidth-16),left=Math.max(8,Math.min(viewportWidth-width-8,rect.right-4-width));
  card.style.position='fixed';card.style.width=width+'px';card.style.maxWidth=width+'px';card.style.left=left+'px';
  const anchorRight=Math.max(left+summaryWidth,Math.min(left+width,rect.right-4));button.style.marginRight=(left+width-anchorRight)+'px';
  const top=Math.max(8,Math.min(viewportHeight-summaryHeight-8,anchorTop));
  const detailHeight=popover.scrollHeight||popover.getBoundingClientRect().height,desiredHeight=summaryHeight+detailHeight;
  const centerY=(Math.max(0,rect.top)+Math.min(viewportHeight,rect.bottom))/2;
  const down=Math.max(0,Math.min(viewportHeight-8,centerY-12)-top),up=Math.max(0,top+summaryHeight-8);
  let direction=small?'up':'down';
  if((direction==='up'?up:down)<Math.min(desiredHeight,summaryHeight+80)&&(direction==='up'?down:up)>(direction==='up'?up:down))direction=direction==='up'?'down':'up';
  const height=Math.min(desiredHeight,direction==='up'?up:down);
  card.setAttribute('data-direction',direction);card.style.maxHeight=height+'px';card.style.top=(direction==='up'?top+summaryHeight-height:top)+'px';
  popover.style.maxHeight=Math.max(0,height-summaryHeight)+'px';
}
async function openInfo(control,trigger){
  clearTimeout(hoverTimer);clearTimeout(closeTimer);
  if(document.querySelector('dialog[open]'))return;
  if(active===control&&!popover.hidden){if(trigger!=='hover')reason=trigger;return}
  if(active){active.button.setAttribute('aria-expanded','false');active.card.setAttribute('data-expanded','false')}
  active=control;reason=trigger;const {image,index,button}=control,version=++requestVersion;
  control.card.setAttribute('data-expanded','true');control.card.append(popover);title.textContent=(index+1)+'번 사진 정보';button.setAttribute('aria-expanded','true');popover.hidden=false;position();message('사진 정보를 확인하고 있습니다.');
  const path=sourcePath(image);if(!path){message('외부 사진의 파일 정보는 확인할 수 없습니다.');return}
  try{
    if(!cache.has(path)){
      const pending=fetch('/api/photo-info?path='+encodeURIComponent(path),{credentials:'same-origin',headers:{accept:'application/json'}}).then(async response=>{if(!response.ok)throw new Error('unavailable');const payload=await response.json();if(!payload.info||typeof payload.info!=='object')throw new Error('unavailable');return payload.info});
      cache.set(path,pending);pending.catch(()=>{if(cache.get(path)===pending)cache.delete(path)});
    }
    const info=await cache.get(path);if(!popover.hidden&&active===control&&version===requestVersion)renderInfo(info,image);
  }catch{if(!popover.hidden&&active===control&&version===requestVersion)message('사진 정보를 불러오지 못했습니다. 잠시 뒤 다시 확인해 주세요.')}
}
function leaveHover(event){clearTimeout(hoverTimer);if(active?.card.contains(event?.relatedTarget)){clearTimeout(closeTimer);return}if(reason==='hover'){clearTimeout(closeTimer);closeTimer=setTimeout(()=>closeInfo(),180)}}
const controls=photos.map((image,index)=>{
  const card=document.createElement('div');card.className='public-photo-info-card';card.setAttribute('data-expanded','false');
  const button=document.createElement('button');button.type='button';button.className='public-photo-info-button';button.setAttribute('aria-controls',popover.id);button.setAttribute('aria-expanded','false');
  const summary=document.createElement('span'),dimensions=document.createElement('span'),size=document.createElement('span');summary.className='public-photo-info-summary';summary.append(dimensions,size);button.append(summary);
  const control={image,index,button,card,dimensions,size};
  card.addEventListener('pointerenter',()=>clearTimeout(closeTimer));card.addEventListener('pointerleave',leaveHover);
  button.addEventListener('pointerenter',event=>{if(event.pointerType==='touch')return;clearTimeout(hoverTimer);clearTimeout(closeTimer);hoverTimer=setTimeout(()=>openInfo(control,'hover'),140)});
  button.addEventListener('pointerleave',leaveHover);
  image.addEventListener('pointerenter',()=>{if(active===control)clearTimeout(closeTimer)});
  image.addEventListener('pointerleave',event=>{if(active===control)leaveHover(event)});
  button.addEventListener('pointerdown',()=>{button.suppressPhotoFocus=true;setTimeout(()=>{button.suppressPhotoFocus=false},0)});
  button.addEventListener('focus',()=>{if(!button.suppressPhotoFocus)window.requestAnimationFrame(()=>{if(document.activeElement===button&&!button.suppressPhotoFocus&&!(active===control&&reason==='click'))openInfo(control,'focus')})});
  button.addEventListener('blur',event=>{if(reason==='focus'&&active===control&&!popover.contains(event.relatedTarget))closeInfo()});
  button.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();if(active===control&&!popover.hidden&&reason==='click')closeInfo();else openInfo(control,'click')});
  card.append(button);layer.append(card);return control;
});
function position(){
  frame=0;
  for(const control of controls){
    const {image,index,button,card,dimensions,size}=control,rect=image.getBoundingClientRect();card.hidden=!image.isConnected||rect.width<=0||rect.height<=0;button.hidden=card.hidden;if(card.hidden)continue;
    const basic=basicInfo(image,rect.width<120);dimensions.textContent=basic.dimensions;size.textContent=basic.size;
    button.setAttribute('aria-label',(index+1)+'번 사진 · '+basic.dimensions+' · '+basic.size+' · 상세 정보');button.style.maxWidth=Math.max(44,rect.width-8)+'px';
    const width=button.offsetWidth||Math.min(140,Math.max(44,rect.width-8)),height=button.offsetHeight||44;
    if(active!==control){card.style.position='absolute';card.style.width='';card.style.maxWidth=Math.max(44,rect.width-8)+'px';card.style.maxHeight='';button.style.marginRight='';card.style.left=Math.max(0,window.scrollX+rect.right-4-width)+'px';card.style.top=Math.max(0,window.scrollY+(rect.height<128?rect.top-height:rect.top+4))+'px'}
  }
  positionPopover();
}
function schedule(){if(!frame)frame=window.requestAnimationFrame(position)}
popover.querySelector('[data-photo-info-close]').addEventListener('click',()=>closeInfo(true));
popover.addEventListener('pointerenter',()=>clearTimeout(closeTimer));popover.addEventListener('pointerleave',leaveHover);
popover.addEventListener('focusin',()=>{reason='focus';clearTimeout(closeTimer)});
popover.addEventListener('focusout',event=>{if(!popover.contains(event.relatedTarget)&&event.relatedTarget!==active?.button)closeInfo()});
document.addEventListener('keydown',event=>{if(event.isComposing||event.keyCode===229)return;if(event.key==='Escape'&&active){event.preventDefault();closeInfo(popover.contains(document.activeElement))}});
document.addEventListener('click',event=>{if(active&&!active.card.contains(event.target))closeInfo()});
window.addEventListener('resize',schedule,{passive:true});window.addEventListener('scroll',schedule,{passive:true});window.addEventListener('load',schedule,{once:true});
body.addEventListener('load',schedule,true);
if(typeof ResizeObserver==='function'){const observer=new ResizeObserver(schedule);observer.observe(body);for(const image of photos)observer.observe(image)}
if(document.fonts&&document.fonts.ready)document.fonts.ready.then(schedule);
position();
})();`;
