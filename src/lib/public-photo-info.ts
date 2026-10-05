import { canonicalPhotoSource, formatPhotoBytes } from './photo-media-summary.ts';
import { photoHdrRows } from './photo-info-presentation.ts';

// Detached controls preserve the article's groups, links and captions. Desktop
// details open on interaction; mobile reads only the currently visible photo.
export const PUBLIC_PHOTO_INFO_BOOTSTRAP = '(function(){\nconst canonicalPhotoSource=' + canonicalPhotoSource.toString() + ';\nconst formatPhotoBytes=' + formatPhotoBytes.toString() + ';\nconst photoHdrRows=' + photoHdrRows.toString() + ';\n' + String.raw`
const body=document.querySelector('.article-page .prose');
if(!body||document.getElementById('publicPhotoInfoPopover'))return;
const photos=Array.from(body.querySelectorAll('img[src]')).filter(image=>!image.closest('[data-ke-type="opengraph"],.se_component.se_oglink,.se-component.se-oglink'));
if(!photos.length)return;
const files=new Map();
try{const seed=JSON.parse(document.getElementById('publicPhotoMetadata')?.textContent||'[]');for(const file of Array.isArray(seed)?seed:[]){if(typeof file?.path==='string')files.set(canonicalPhotoSource(file.path),file)}}catch{}
const layer=document.createElement('div');layer.className='public-photo-info-controls';
const popover=document.createElement('section');popover.id='publicPhotoInfoPopover';popover.className='public-photo-info-popover';popover.hidden=true;popover.setAttribute('aria-label','사진 정보');
popover.innerHTML='<button class="public-photo-info-close" type="button" data-photo-info-close aria-label="사진 정보 닫기">×</button><div data-photo-info-content aria-live="polite"></div>';
document.body.append(layer);layer.append(popover);
const mobileBar=document.createElement('aside');mobileBar.className='public-photo-info-mobile';mobileBar.hidden=true;mobileBar.setAttribute('aria-label','현재 사진 정보');mobileBar.setAttribute('aria-live','polite');layer.append(mobileBar);
const content=popover.querySelector('[data-photo-info-content]');
let active=null,reason='',requestVersion=0,frame=0,hoverTimer=null,closeTimer=null,mobileActive=null,mobilePreferred=null,mobilePath=null,mobileVersion=0;
const cache=new Map(),readResults=new Map(),mobileFailures=new Set(),positive=value=>Number.isSafeInteger(value)&&value>0;
const mobileMode=()=>window.innerWidth<=767;
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
function readInfo(path){
  if(!cache.has(path)){
    const pending=fetch('/api/photo-info?path='+encodeURIComponent(path),{credentials:'same-origin',headers:{accept:'application/json'}}).then(async response=>{if(!response.ok)throw new Error('unavailable');const payload=await response.json();if(!payload.info||typeof payload.info!=='object')throw new Error('unavailable');readResults.set(path,payload.info);mobileFailures.delete(path);return payload.info});
    cache.set(path,pending);pending.catch(()=>{if(cache.get(path)===pending)cache.delete(path)});
  }
  return cache.get(path);
}
function mobileText(control,info=null){
  const {image,index}=control,path=sourcePath(image),file=path?files.get(path):null,basic=basicInfo(image);
  mobileBar.setAttribute('aria-label',(index+1)+'번 사진 정보');
  const inferred={jpeg:'JPEG',jpg:'JPEG',png:'PNG',webp:'WebP',gif:'GIF',avif:'AVIF',svg:'SVG','svg+xml':'SVG'};
  const format=info?.format||inferred[(file?.mime||'').split('/')[1]]||'파일 형식 미확인';
  const dimensions=String(format).toUpperCase()==='SVG'?'벡터 이미지':positive(info?.width)&&positive(info?.height)?info.width+' × '+info.height+' px':basic.dimensions;
  const size=positive(info?.bytes)?formatPhotoBytes(info.bytes):basic.size;
  const values=[format,dimensions,size,info?.colorSpace||'색영역 미확인'];
  if(info?.profileName&&info.profileName!==info.colorSpace)values.push('프로필: '+info.profileName);
  for(const [label,value] of photoHdrRows(info||{hdr:'unknown'}))values.push(label+': '+value);
  if(!path)values.push('외부 사진의 상세 정보 미확인');else if(mobileFailures.has(path)&&!info)values.push('상세 정보 확인 실패');
  if(mobileBar.textContent===values.join(' / '))return;
  mobileBar.replaceChildren();for(const [index,value] of values.entries()){const item=document.createElement('span');item.textContent=(index?' / ':'')+value;mobileBar.append(item)}
}
function positionMobile(){
  const header=document.querySelector('.site-header');
  if(header&&mobileBar.closest('.site-header')!==header)header.append(mobileBar);
  const headerBottom=header?.getBoundingClientRect().bottom||0,baseBottom=header?.querySelector('.site-header__inner')?.getBoundingClientRect().bottom??headerBottom;
  const top=Math.max(0,baseBottom),target=top+8,visible=controls.map(control=>({control,rect:control.image.getBoundingClientRect()})).filter(({control,rect})=>control.image.isConnected&&rect.width>0&&rect.height>0&&rect.bottom>top&&rect.top<window.innerHeight);
  visible.sort((a,b)=>Math.max(a.rect.top-target,target-a.rect.bottom,0)-Math.max(b.rect.top-target,target-b.rect.bottom,0));
  if(mobilePreferred&&!visible.some(({control})=>control===mobilePreferred))mobilePreferred=null;
  const control=mobilePreferred||visible[0]?.control||null,path=control?sourcePath(control.image):null;
  if(!control){mobileBar.hidden=true;if(mobileActive){mobileActive=null;mobilePath=null;mobileVersion++}return}
  mobileBar.hidden=false;
  if(mobileActive===control&&mobilePath===path){mobileText(control,readResults.get(path));return}
  mobileActive=control;mobilePath=path;const version=++mobileVersion;
  mobileText(control,readResults.get(path));
  if(!path||readResults.has(path)||mobileFailures.has(path))return;
  readInfo(path).then(info=>{if(mobileMode()&&mobileActive===control&&mobilePath===path&&mobileVersion===version){mobileText(control,info);schedule()}},()=>{mobileFailures.add(path);if(mobileMode()&&mobileActive===control&&mobilePath===path&&mobileVersion===version)mobileText(control)});
}
function message(text){content.replaceChildren();const paragraph=document.createElement('p');paragraph.textContent=text;content.append(paragraph);positionPopover()}
function renderInfo(info,image){
  content.replaceChildren();const list=document.createElement('dl');
  function row(label,value){const group=document.createElement('div'),name=document.createElement('dt'),detail=document.createElement('dd');group.className='public-photo-info-row';name.textContent=label;detail.textContent=value;group.append(name,detail);list.append(group)}
  const dimensions=positive(info.width)&&positive(info.height)?[info.width,info.height]:image.complete&&positive(image.naturalWidth)&&positive(image.naturalHeight)?[image.naturalWidth,image.naturalHeight]:null;
  const basic=document.createElement('p');basic.className='public-photo-info-popover__basic';basic.textContent=[info.format||'형식 미확인',String(info.format||'').toUpperCase()==='SVG'?'벡터 이미지':dimensions?dimensions[0]+' × '+dimensions[1]+' px':'해상도 미확인',positive(info.bytes)?formatPhotoBytes(info.bytes):'용량 미확인'].join(' · ');
  row('색영역',info.colorSpace||'미확인');
  if(info.profileName&&info.profileName!==info.colorSpace)row('프로필',info.profileName);
  for(const [label,value] of photoHdrRows(info))row(label,value);
  content.append(basic,list);
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
  const anchorHeight=active.summaryHeight||button.offsetHeight||44,small=rect.height<128;
  const anchorTop=small?rect.top-anchorHeight:rect.top+4;
  if(!image.isConnected||anchorTop+anchorHeight<=0||anchorTop>=viewportHeight){closeInfo();return}
  popover.style.maxHeight='';
  card.setAttribute('data-presentation','plain');
  const plainHeight=popover.scrollHeight||popover.getBoundingClientRect().height,callout=rect.width<440||plainHeight>rect.height-8;
  card.setAttribute('data-presentation',callout?'callout':'plain');
  const headerRect=document.querySelector('.site-header')?.getBoundingClientRect();
  const rail=callout&&headerRect&&headerRect.width<viewportWidth/2;
  const horizontal=callout&&headerRect&&headerRect.width>viewportWidth*.75;
  const safeLeft=rail?Math.max(8,headerRect.right+8):8,safeTop=horizontal?Math.max(8,headerRect.bottom+8):8;
  const safeWidth=Math.max(44,viewportWidth-safeLeft-8),rightSpace=viewportWidth-8-rect.right-12,leftSpace=rect.left-safeLeft-12;
  let width=Math.min(440,safeWidth),side='top';
  if(callout&&rightSpace>=320){width=Math.min(width,rightSpace);side='left'}else if(callout&&leftSpace>=320){width=Math.min(width,leftSpace);side='right'}
  const wantedLeft=side==='left'?rect.right+12:side==='right'?rect.left-width-12:rect.right-4-width;
  const left=Math.max(safeLeft,Math.min(viewportWidth-width-8,wantedLeft));
  card.style.position='fixed';card.style.width=width+'px';card.style.maxWidth=width+'px';card.style.left=left+'px';
  button.style.marginRight='';
  const top=Math.max(safeTop,Math.min(viewportHeight-anchorHeight-8,anchorTop));
  const desiredHeight=popover.scrollHeight||popover.getBoundingClientRect().height;
  const down=Math.max(0,viewportHeight-8-top),up=Math.max(0,top+anchorHeight-safeTop);
  let direction=small?'up':'down';
  if((direction==='up'?up:down)<desiredHeight&&(direction==='up'?down:up)>(direction==='up'?up:down))direction=direction==='up'?'down':'up';
  // Read every row when the screen can fit them. Shift the card if needed;
  // only a genuinely short viewport requires scrolling inside the details.
  const panelFloor=safeTop+(callout&&side==='top'?10:0);
  const availableHeight=viewportHeight-panelFloor-8;
  if(availableHeight<44){closeInfo();return}
  const height=Math.min(desiredHeight,availableHeight);
  const panelTop=Math.max(panelFloor,Math.min(viewportHeight-height-8,direction==='up'?top+anchorHeight-height:top));
  card.setAttribute('data-direction',direction);card.style.maxHeight=height+'px';card.style.top=panelTop+'px';
  popover.style.maxHeight=height+'px';
  if(callout){
    card.setAttribute('data-tail',side);
    card.style.setProperty('--photo-info-tail-x',Math.max(18,Math.min(width-18,rect.left+rect.width/2-left))+'px');
    card.style.setProperty('--photo-info-tail-y',Math.max(18,Math.min(height-18,anchorTop+anchorHeight/2-panelTop))+'px');
    const summaryWidth=active.summaryWidth||72,bridgeLeft=Math.max(safeLeft,rect.right-4-summaryWidth),bridgeTop=Math.max(safeTop,Math.min(viewportHeight-anchorHeight-8,anchorTop));
    card.style.setProperty('--photo-info-bridge-left',Math.min(bridgeLeft,left)-left+'px');
    card.style.setProperty('--photo-info-bridge-top',bridgeTop-panelTop+'px');
    card.style.setProperty('--photo-info-bridge-width',Math.max(bridgeLeft+summaryWidth,left+width)-Math.min(bridgeLeft,left)+'px');
    card.style.setProperty('--photo-info-bridge-height',anchorHeight+'px');
  }
}
async function openInfo(control,trigger){
  clearTimeout(hoverTimer);clearTimeout(closeTimer);
  if(mobileMode()||document.querySelector('dialog[open]'))return;
  if(active===control&&!popover.hidden){if(trigger!=='hover')reason=trigger;return}
  if(active){active.button.setAttribute('aria-expanded','false');active.card.setAttribute('data-expanded','false')}
  active=control;reason=trigger;const {image,index,button}=control,version=++requestVersion;
  control.card.setAttribute('data-expanded','true');control.card.append(popover);popover.setAttribute('aria-label',(index+1)+'번 사진 정보');button.setAttribute('aria-expanded','true');popover.hidden=false;position();if(active!==control||popover.hidden)return;message('사진 정보를 확인하고 있습니다.');
  const path=sourcePath(image);if(!path){message('외부 사진의 파일 정보는 확인할 수 없습니다.');return}
  try{
    const info=await readInfo(path);if(!popover.hidden&&active===control&&version===requestVersion)renderInfo(info,image);
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
  image.addEventListener('pointerleave',event=>{if(active===control)leaveHover(event)});
  image.addEventListener('pointerdown',()=>{if(mobileMode()){mobilePreferred=control;schedule()}});
  button.addEventListener('pointerdown',()=>{button.suppressPhotoFocus=true;setTimeout(()=>{button.suppressPhotoFocus=false},0)});
  button.addEventListener('focus',()=>{if(!button.suppressPhotoFocus)window.requestAnimationFrame(()=>{if(document.activeElement===button&&!button.suppressPhotoFocus&&!(active===control&&reason==='click'))openInfo(control,'focus')})});
  button.addEventListener('blur',event=>{if(reason==='focus'&&active===control&&!popover.contains(event.relatedTarget))closeInfo()});
  button.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();if(active===control&&!popover.hidden&&reason==='click')closeInfo();else openInfo(control,'click')});
  card.append(button);layer.append(card);return control;
});
function position(){
  frame=0;
  const mobile=mobileMode();layer.setAttribute('data-mobile',String(mobile));
  if(mobile&&active){closeInfo();return}
  if(!mobile){mobileBar.hidden=true;if(mobileBar.closest('.site-header'))layer.append(mobileBar);mobilePreferred=null;if(mobileActive){mobileActive=null;mobilePath=null;mobileVersion++}}
  for(const control of controls){
    const {image,index,button,card,dimensions,size}=control,rect=image.getBoundingClientRect();card.hidden=mobile||!image.isConnected||rect.width<=0||rect.height<=0;button.hidden=card.hidden;if(card.hidden)continue;
    const basic=basicInfo(image),compact=rect.width<230;dimensions.textContent=compact?'ⓘ 정보':basic.dimensions;size.textContent=basic.size;size.hidden=compact;
    button.setAttribute('aria-label',(index+1)+'번 사진 · '+basic.dimensions+' · '+basic.size+' · 상세 정보');button.style.maxWidth=Math.max(44,rect.width-8)+'px';
    const width=button.offsetWidth||Math.min(compact?72:180,Math.max(44,rect.width-8)),height=button.offsetHeight||44;
    if(active!==control){control.summaryHeight=height;control.summaryWidth=width;card.setAttribute('data-presentation','plain')}
    if(active!==control){card.style.position='absolute';card.style.width='';card.style.maxWidth=Math.max(44,rect.width-8)+'px';card.style.maxHeight='';button.style.marginRight='';card.style.left=Math.max(0,window.scrollX+rect.right-4-width)+'px';card.style.top=Math.max(0,window.scrollY+(rect.height<128?rect.top-height:rect.top+4))+'px'}
  }
  if(mobile){positionMobile();return}
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
