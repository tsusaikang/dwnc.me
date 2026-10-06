import { canonicalPhotoSource, formatPhotoBytes } from './photo-media-summary.ts';
import { photoColorRows, photoHdrRows } from './photo-info-presentation.ts';
import { createPhotoInfoPreloader } from './photo-info-preload.ts';

// Detached controls preserve the article's groups, links and captions. Desktop
// details open on interaction; mobile displays each photo's basic information.
export const PUBLIC_PHOTO_INFO_BOOTSTRAP = '(function(){\nconst canonicalPhotoSource=' + canonicalPhotoSource.toString() + ';\nconst formatPhotoBytes=' + formatPhotoBytes.toString() + ';\nconst photoColorRows=' + photoColorRows.toString() + ';\nconst photoHdrRows=' + photoHdrRows.toString() + ';\nconst createPhotoInfoPreloader=' + createPhotoInfoPreloader.toString() + ';\n' + String.raw`
const body=document.querySelector('.article-page .prose');
if(!body||document.getElementById('publicPhotoInfoPopover'))return;
const photos=Array.from(body.querySelectorAll('img[src]')).filter(image=>!image.closest('[data-ke-type="opengraph"],.se_component.se_oglink,.se-component.se-oglink'));
if(!photos.length)return;
const files=new Map();
try{const seed=JSON.parse(document.getElementById('publicPhotoMetadata')?.textContent||'[]');for(const file of Array.isArray(seed)?seed:[]){if(typeof file?.path==='string')files.set(canonicalPhotoSource(file.path),file)}}catch{}
const layer=document.createElement('div');layer.className='public-photo-info-controls';
const panel=document.createElement('div');panel.className='public-photo-info-panel';panel.hidden=true;
const popover=document.createElement('section');popover.id='publicPhotoInfoPopover';popover.className='public-photo-info-popover';popover.hidden=true;popover.setAttribute('aria-label','사진 정보');
popover.innerHTML='<div data-photo-info-content aria-live="polite"></div><button class="public-photo-info-close" type="button" data-photo-info-close aria-label="사진 정보 닫기">×</button>';
document.body.append(layer);layer.append(panel);panel.append(popover);
const content=popover.querySelector('[data-photo-info-content]');
let active=null,reason='',requestVersion=0,frame=0,hoverTimer=null,closeTimer=null;
const cache=new Map(),ready=new Map(),positive=value=>Number.isSafeInteger(value)&&value>0;
const mobileMode=()=>window.innerWidth<=767;
const preloader=createPhotoInfoPreloader(()=>{
  if(mobileMode())return [];
  return controls.filter(({image})=>{const rect=image.getBoundingClientRect();return image.isConnected&&rect.width>0&&rect.height>0&&rect.bottom>-600&&rect.top<window.innerHeight+600&&rect.right>0&&rect.left<window.innerWidth}).map(({image})=>sourcePath(image)).filter(path=>path&&!ready.has(path));
},readInfo);
function sourcePath(image){
  let source=image.getAttribute('src')||'';
  try{const url=new URL(source,location.href);if(/^https?:\/\//i.test(source)&&url.origin===location.origin){url.protocol='https:';url.host='dwnc.me';url.port='';source=url.href}}catch{}
  const path=canonicalPhotoSource(source);return path.startsWith('/media/')?path:null;
}
function basicInfo(image){
  const path=sourcePath(image),file=path?files.get(path):null;
  const formats={jpeg:'JPEG',jpg:'JPEG',png:'PNG',webp:'WebP',gif:'GIF',avif:'AVIF',svg:'SVG','svg+xml':'SVG'};
  const mime=(file?.mime||'').split('/')[1],extension=path?.split(/[?#]/)[0].split('.').pop()?.toLowerCase();
  const format=formats[mime]||(!mime&&formats[extension])||'형식 미확인';
  const dimensions=format==='SVG'?'벡터 이미지':positive(image.naturalWidth)&&positive(image.naturalHeight)?image.naturalWidth+' × '+image.naturalHeight:'해상도 미확인';
  return{format,dimensions,size:positive(file?.bytes)?formatPhotoBytes(file.bytes):'용량 미확인'};
}
function readInfo(path){
  if(!cache.has(path)){
    const pending=fetch('/api/photo-info?path='+encodeURIComponent(path),{credentials:'same-origin',headers:{accept:'application/json'}}).then(async response=>{if(!response.ok)throw new Error('unavailable');const payload=await response.json();if(!payload.info||typeof payload.info!=='object')throw new Error('unavailable');ready.set(path,payload.info);return payload.info});
    cache.set(path,pending);pending.catch(()=>{if(cache.get(path)===pending)cache.delete(path)});
  }
  return cache.get(path);
}
function message(text){content.replaceChildren();const paragraph=document.createElement('p');paragraph.textContent=text;content.append(paragraph);positionPopover()}
function renderInfo(info){
  content.replaceChildren();
  const lines=[...photoColorRows(info),...photoHdrRows(info)];
  for(const [label,value,note] of lines){const line=document.createElement('p');line.className='public-photo-info-row';line.textContent=label+' · '+value;if(note)line.setAttribute('title',note);content.append(line)}
  positionPopover();
}
function closeInfo(restoreFocus=false){
  clearTimeout(hoverTimer);clearTimeout(closeTimer);requestVersion++;const button=active?.button;
  if(button){button.setAttribute('aria-expanded','false');active.card.setAttribute('data-expanded','false')}active=null;reason='';popover.hidden=true;panel.hidden=true;position();
  if(restoreFocus&&button?.isConnected){button.suppressPhotoFocus=true;button.focus({preventScroll:true});button.suppressPhotoFocus=false}
}
function inInfo(target){return Boolean(active&&(active.card.contains(target)||panel.contains(target)))}
function positionPopover(){
  if(!active||popover.hidden)return;
  const {image,button,summary}=active,rect=image.getBoundingClientRect(),viewportWidth=document.documentElement?.clientWidth||window.innerWidth,viewportHeight=window.innerHeight;
  const anchorHeight=button.offsetHeight||44,visualHeight=summary.offsetHeight||14*1.45,small=rect.height<128;
  const anchorTop=small?rect.top-anchorHeight:rect.top+4;
  if(!image.isConnected||anchorTop+anchorHeight<=0||anchorTop>=viewportHeight){closeInfo();return}
  popover.style.maxHeight='none';popover.style.overflow='visible';panel.style.width='fit-content';panel.style.maxWidth=Math.min(440,viewportWidth-16)+'px';
  panel.setAttribute('data-presentation','plain');
  const plainHeight=Math.ceil(Math.max(popover.scrollHeight||0,popover.getBoundingClientRect().height)),below=viewportHeight-anchorTop-visualHeight-16;
  const callout=rect.width<440||visualHeight+12+plainHeight>rect.height-8||below<Math.max(46,plainHeight);
  panel.setAttribute('data-presentation',callout?'callout':'plain');
  active.card.setAttribute('data-presentation',callout?'callout':'plain');
  const headerRect=document.querySelector('.site-header')?.getBoundingClientRect();
  const rail=callout&&headerRect&&headerRect.width<viewportWidth/2;
  const horizontal=callout&&headerRect&&headerRect.width>viewportWidth*.75;
  const safeLeft=rail?Math.max(8,headerRect.right+8):8,safeTop=horizontal?Math.max(8,headerRect.bottom+8):8;
  const safeWidth=Math.max(44,viewportWidth-safeLeft-8),rightSpace=viewportWidth-8-rect.right-12,leftSpace=rect.left-safeLeft-12;
  let width=Math.min(440,safeWidth),side='top';
  if(callout&&rightSpace>=320){width=Math.min(width,rightSpace);side='left'}else if(callout&&leftSpace>=320){width=Math.min(width,leftSpace);side='right'}
  const wantedLeft=side==='left'?rect.right+12:side==='right'?rect.left-width-12:rect.right-4-width;
  const left=Math.max(safeLeft,Math.min(viewportWidth-width-8,wantedLeft));
  panel.style.position='fixed';panel.style.width=callout?width+'px':'fit-content';panel.style.maxWidth=(callout?width:Math.min(440,Math.max(44,rect.right-4-safeLeft)))+'px';
  panel.style.left=callout?left+'px':'';panel.style.right=callout?'':Math.max(8,viewportWidth-rect.right+4)+'px';
  const top=Math.max(safeTop,Math.min(viewportHeight-anchorHeight-8,anchorTop));
  const desiredHeight=Math.ceil(Math.max(popover.scrollHeight||0,popover.getBoundingClientRect().height));
  const down=Math.max(0,viewportHeight-8-top),up=Math.max(0,top+anchorHeight-safeTop);
  let direction=small?'up':'down';
  if((direction==='up'?up:down)<desiredHeight&&(direction==='up'?down:up)>(direction==='up'?up:down))direction=direction==='up'?'down':'up';
  // Read every row when the screen can fit them. Shift the card if needed;
  // only a genuinely short viewport requires scrolling inside the details.
  const panelFloor=callout?safeTop+(side==='top'?10:0):anchorTop+4+visualHeight+4;
  const availableHeight=viewportHeight-panelFloor-8;
  if(availableHeight<46){closeInfo();return}
  const height=Math.min(desiredHeight,availableHeight);
  const panelTop=callout?Math.max(panelFloor,Math.min(viewportHeight-height-8,direction==='up'?top+anchorHeight-height:top)):panelFloor;
  panel.setAttribute('data-direction',direction);panel.style.top=panelTop+'px';panel.style.maxHeight=height+'px';
  const limited=height<desiredHeight;popover.style.maxHeight=limited?height+'px':'none';popover.style.overflow=limited?'auto':'visible';
  if(callout){
    panel.setAttribute('data-tail',side);
    panel.style.setProperty('--photo-info-tail-x',Math.max(18,Math.min(width-18,rect.left+rect.width/2-left))+'px');
    panel.style.setProperty('--photo-info-tail-y',Math.max(18,Math.min(height-18,anchorTop+anchorHeight/2-panelTop))+'px');
    const summaryWidth=button.offsetWidth||Math.min(260,Math.max(44,rect.width-8)),bridgeLeft=Math.max(safeLeft,rect.right-4-summaryWidth),bridgeTop=Math.max(safeTop,Math.min(viewportHeight-anchorHeight-8,anchorTop));
    panel.style.setProperty('--photo-info-bridge-left',Math.min(bridgeLeft,left)-left+'px');
    panel.style.setProperty('--photo-info-bridge-top',bridgeTop-panelTop+'px');
    panel.style.setProperty('--photo-info-bridge-width',Math.max(bridgeLeft+summaryWidth,left+width)-Math.min(bridgeLeft,left)+'px');
    panel.style.setProperty('--photo-info-bridge-height',anchorHeight+'px');
  }
}
async function openInfo(control,trigger){
  clearTimeout(hoverTimer);clearTimeout(closeTimer);
  if(mobileMode()||document.querySelector('dialog[open]'))return;
  if(active===control&&!popover.hidden){if(trigger!=='hover')reason=trigger;return}
  if(active){active.button.setAttribute('aria-expanded','false');active.card.setAttribute('data-expanded','false')}
  active=control;reason=trigger;const {image,index,button}=control,version=++requestVersion;
  const path=sourcePath(image);control.detailPath=path;
  control.card.setAttribute('data-expanded','true');popover.setAttribute('aria-label',(index+1)+'번 사진 정보');button.setAttribute('aria-expanded','true');popover.hidden=false;panel.hidden=false;position();if(active!==control||popover.hidden)return;
  if(!path){message('외부 사진의 파일 정보는 확인할 수 없습니다.');return}
  if(ready.has(path)){renderInfo(ready.get(path));return}
  message('사진 정보를 확인하고 있습니다.');
  try{
    const info=await readInfo(path);if(!popover.hidden&&active===control&&version===requestVersion&&sourcePath(image)===path)renderInfo(info);
  }catch{if(!popover.hidden&&active===control&&version===requestVersion&&sourcePath(image)===path)message('사진 정보를 불러오지 못했습니다. 잠시 뒤 다시 확인해 주세요.')}
}
function leaveHover(event){clearTimeout(hoverTimer);if(inInfo(event?.relatedTarget)){clearTimeout(closeTimer);return}if(reason==='hover'){clearTimeout(closeTimer);closeTimer=setTimeout(()=>closeInfo(),180)}}
function createControl(image,index){
  const card=document.createElement('div');card.className='public-photo-info-card';card.setAttribute('data-expanded','false');
  const button=document.createElement('button');button.type='button';button.className='public-photo-info-button';button.setAttribute('aria-controls',popover.id);button.setAttribute('aria-expanded','false');
  const summary=document.createElement('span');summary.className='public-photo-info-summary';button.append(summary);
  const control={image,index,button,card,summary};
  card.addEventListener('pointerenter',()=>clearTimeout(closeTimer));card.addEventListener('pointerleave',leaveHover);
  button.addEventListener('pointerenter',event=>{if(event.pointerType==='touch')return;clearTimeout(hoverTimer);clearTimeout(closeTimer);hoverTimer=setTimeout(()=>openInfo(control,'hover'),140)});
  button.addEventListener('pointerleave',leaveHover);
  image.addEventListener('pointerleave',event=>{if(active===control)leaveHover(event)});
  button.addEventListener('pointerdown',()=>{button.suppressPhotoFocus=true;setTimeout(()=>{button.suppressPhotoFocus=false},0)});
  button.addEventListener('focus',()=>{if(!button.suppressPhotoFocus)window.requestAnimationFrame(()=>{if(document.activeElement===button&&!button.suppressPhotoFocus&&!(active===control&&reason==='click'))openInfo(control,'focus')})});
  button.addEventListener('blur',event=>{if(reason==='focus'&&active===control&&!popover.contains(event.relatedTarget))closeInfo()});
  button.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();if(active===control&&!popover.hidden&&reason==='click')closeInfo();else openInfo(control,'click')});
  card.append(button);layer.append(card);return control;
}
const controls=photos.map(createControl);
function position(){
  frame=0;
  const mobile=mobileMode();layer.setAttribute('data-mobile',String(mobile));
  if(mobile&&active){closeInfo();return}
  const currentPhotos=Array.from(body.querySelectorAll('img[src]')).filter(image=>!image.closest('[data-ke-type="opengraph"],.se_component.se_oglink,.se-component.se-oglink'));
  let removedActive=false;
  for(let index=controls.length-1;index>=0;index--){const control=controls[index];if(!currentPhotos.includes(control.image)){removedActive||=active===control;control.card.remove();controls.splice(index,1)}}
  if(removedActive){closeInfo();return}
  for(const [index,image] of currentPhotos.entries()){let control=controls.find(item=>item.image===image);if(!control){control=createControl(image,index);controls.push(control)}control.index=index}
  if(active&&sourcePath(active.image)!==active.detailPath){closeInfo();return}
  for(const control of controls){
    const {image,index,button,card,summary}=control,rect=image.getBoundingClientRect();card.hidden=!image.isConnected||rect.width<=0||rect.height<=0;button.hidden=card.hidden;if(card.hidden)continue;
    const basic=basicInfo(image),text=[basic.format,basic.dimensions,basic.size].join(' · ');if(summary.textContent!==text)summary.textContent=text;
    button.setAttribute('aria-label',(index+1)+'번 사진 · '+text+(mobile?'':' · 상세 정보'));button.disabled=mobile;button.setAttribute('tabindex',mobile?'-1':'0');button.style.maxWidth=Math.max(0,rect.width-8)+'px';
    const width=button.offsetWidth||Math.min(260,Math.max(0,rect.width-8)),height=button.offsetHeight||44;
    if(active!==control)card.setAttribute('data-presentation','plain');
    card.style.position='absolute';card.style.width='';card.style.maxWidth=Math.max(0,rect.width-8)+'px';card.style.maxHeight='';card.style.left=Math.max(0,window.scrollX+(mobile?rect.left+4:rect.right-4-width))+'px';card.style.top=Math.max(0,window.scrollY+(!mobile&&rect.height<128?rect.top-height:rect.top+4))+'px';
  }
  if(mobile)return;
  positionPopover();
  preloader.schedule();
}
function schedule(){if(!frame)frame=window.requestAnimationFrame(position)}
popover.querySelector('[data-photo-info-close]').addEventListener('click',()=>closeInfo(true));
panel.addEventListener('pointerenter',()=>clearTimeout(closeTimer));panel.addEventListener('pointerleave',leaveHover);
popover.addEventListener('pointerenter',()=>clearTimeout(closeTimer));popover.addEventListener('pointerleave',leaveHover);
popover.addEventListener('focusin',()=>{reason='focus';clearTimeout(closeTimer)});
popover.addEventListener('focusout',event=>{if(!popover.contains(event.relatedTarget)&&event.relatedTarget!==active?.button)closeInfo()});
document.addEventListener('keydown',event=>{if(event.isComposing||event.keyCode===229)return;if(event.key==='Escape'&&active){event.preventDefault();closeInfo(popover.contains(document.activeElement))}});
document.addEventListener('click',event=>{if(active&&!inInfo(event.target))closeInfo()});
window.addEventListener('resize',schedule,{passive:true});window.addEventListener('scroll',schedule,{passive:true});window.addEventListener('load',schedule,{once:true});
body.addEventListener('load',schedule,true);
if(typeof ResizeObserver==='function'){const observer=new ResizeObserver(schedule);observer.observe(body);for(const image of photos)observer.observe(image)}
// A late edit link can move every photo without resizing the prose or images.
// Observe the article/header, leaving detached controls outside this observer.
if(typeof MutationObserver==='function'){
  const observer=new MutationObserver(schedule),options={childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:['hidden','class','style','src','srcset','sizes','width','height']};
  observer.observe(body.closest('.article-page')||body,options);
  const header=document.querySelector('.site-header');if(header)observer.observe(header,options);
}
if(document.fonts&&document.fonts.ready)document.fonts.ready.then(schedule);
position();
})();`;
