import { canonicalPhotoSource, formatPhotoBytes } from './photo-media-summary.ts';

// Detached, noninteractive labels preserve the article's links and captions.
export const PUBLIC_PHOTO_INFO_BOOTSTRAP = '(function(){\nconst canonicalPhotoSource=' + canonicalPhotoSource.toString() + ';\nconst formatPhotoBytes=' + formatPhotoBytes.toString() + ';\n' + String.raw`
const body=document.querySelector('.article-page .prose');
if(!body||document.querySelector('.public-photo-info-controls'))return;
const photos=Array.from(body.querySelectorAll('img[src]')).filter(image=>!image.closest('[data-ke-type="opengraph"],.se_component.se_oglink,.se-component.se-oglink'));
if(!photos.length)return;
const files=new Map();
try{const seed=JSON.parse(document.getElementById('publicPhotoMetadata')?.textContent||'[]');for(const file of Array.isArray(seed)?seed:[]){if(typeof file?.path==='string')files.set(canonicalPhotoSource(file.path),file)}}catch{}
const layer=document.createElement('div');layer.className='public-photo-info-controls';document.body.append(layer);
let frame=0;
const positive=value=>Number.isSafeInteger(value)&&value>0;
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
const controls=photos.map(image=>{
  const card=document.createElement('div');card.className='public-photo-info-card';
  const basic=document.createElement('div');basic.className='public-photo-info-basic';
  const summary=document.createElement('span');summary.className='public-photo-info-summary';basic.append(summary);card.append(basic);layer.append(card);
  return{image,basic,card,summary};
});
function position(){
  frame=0;const mobile=window.innerWidth<=767;layer.setAttribute('data-mobile',String(mobile));
  for(const {image,basic,card,summary} of controls){
    const rect=image.getBoundingClientRect();card.hidden=!image.isConnected||rect.width<=0||rect.height<=0;if(card.hidden)continue;
    const info=basicInfo(image),text=[info.format,info.dimensions,info.size].join(' · ');if(summary.textContent!==text)summary.textContent=text;
    basic.style.maxWidth=Math.max(0,rect.width-8)+'px';
    const width=basic.offsetWidth||Math.min(260,Math.max(0,rect.width-8)),height=basic.offsetHeight||44;
    card.style.maxWidth=Math.max(0,rect.width-8)+'px';card.style.left=Math.max(0,window.scrollX+(mobile?rect.left+4:rect.right-4-width))+'px';card.style.top=Math.max(0,window.scrollY+(!mobile&&rect.height<128?rect.top-height:rect.top+4))+'px';
  }
}
function schedule(){if(!frame)frame=window.requestAnimationFrame(position)}
window.addEventListener('resize',schedule,{passive:true});window.addEventListener('scroll',schedule,{passive:true});window.addEventListener('load',schedule,{once:true});
body.addEventListener('load',schedule,true);body.addEventListener('error',schedule,true);
if(typeof ResizeObserver==='function'){const observer=new ResizeObserver(schedule);observer.observe(body);for(const image of photos)observer.observe(image)}
// A late edit link can move photos without resizing the prose or images.
// Detached labels stay outside the observed article to avoid a placement loop.
if(typeof MutationObserver==='function'){
  const observer=new MutationObserver(schedule),options={childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:['hidden','class','style','src','srcset','sizes','width','height']};
  observer.observe(body.closest('.article-page')||body,options);
  const header=document.querySelector('.site-header');if(header)observer.observe(header,options);
}
if(document.fonts&&document.fonts.ready)document.fonts.ready.then(schedule);
position();
})();`;
