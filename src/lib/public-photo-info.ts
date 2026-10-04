import { canonicalPhotoSource, formatPhotoBytes } from './photo-media-summary.ts';

// Keep controls outside the article body: links, photo groups and captions retain
// their original DOM, and opening information never reloads the displayed image.
export const PUBLIC_PHOTO_INFO_BOOTSTRAP = '(function(){\nconst canonicalPhotoSource=' + canonicalPhotoSource.toString() + ';\nconst formatPhotoBytes=' + formatPhotoBytes.toString() + ';\n' + String.raw`
const body=document.querySelector('.article-page .prose');
if(!body||document.getElementById('publicPhotoInfoDialog'))return;
const photos=Array.from(body.querySelectorAll('img[src]')).filter(image=>!image.closest('[data-ke-type="opengraph"],.se_component.se_oglink,.se-component.se-oglink'));
if(!photos.length)return;
const layer=document.createElement('div');layer.className='public-photo-info-controls';
const dialog=document.createElement('dialog');dialog.id='publicPhotoInfoDialog';dialog.className='public-photo-info-dialog';dialog.setAttribute('aria-labelledby','publicPhotoInfoTitle');
dialog.innerHTML='<div class="public-photo-info-dialog__header"><h2 id="publicPhotoInfoTitle">사진 정보</h2><button type="button" data-photo-info-close aria-label="사진 정보 닫기">닫기 ×</button></div><div data-photo-info-content aria-live="polite"></div>';
document.body.append(layer,dialog);
const title=dialog.querySelector('h2'),content=dialog.querySelector('[data-photo-info-content]'),close=dialog.querySelector('[data-photo-info-close]');
let opener=null,requestVersion=0,frame=0;
const cache=new Map();
function sourcePath(image){
  let source=image.getAttribute('src')||'';
  try{const url=new URL(source,location.href);if(/^https?:\/\//i.test(source)&&url.origin===location.origin){url.protocol='https:';url.host='dwnc.me';url.port='';source=url.href}}catch{}
  const path=canonicalPhotoSource(source);return path.startsWith('/media/')?path:null;
}
function message(text){content.replaceChildren();const paragraph=document.createElement('p');paragraph.textContent=text;content.append(paragraph)}
function renderInfo(info,image){
  content.replaceChildren();const list=document.createElement('dl');
  function row(label,value){const name=document.createElement('dt'),detail=document.createElement('dd');name.textContent=label;detail.textContent=value;list.append(name,detail)}
  const positive=value=>Number.isSafeInteger(value)&&value>0;
  const dimensions=positive(info.width)&&positive(info.height)?[info.width,info.height]:image.complete&&positive(image.naturalWidth)&&positive(image.naturalHeight)?[image.naturalWidth,image.naturalHeight]:null;
  row('해상도',String(info.format||'').toUpperCase()==='SVG'?'벡터 이미지':dimensions?dimensions[0]+' × '+dimensions[1]+' px':'미확인');
  row('저장 용량',positive(info.bytes)?formatPhotoBytes(info.bytes)+' ('+info.bytes.toLocaleString('ko-KR')+' 바이트)':'미확인');
  row('파일 형식',info.format||'미확인');row('색영역',info.colorSpace||'미확인');
  if(info.profileName&&info.profileName!==info.colorSpace)row('색상 프로필',info.profileName);
  row('HDR 정보',info.hdr==='metadata-present'?'HDR 메타데이터 있음':info.hdr==='not-indicated'?'HDR 표시 없음':'미확인');
  content.append(list);
  if(info.hdr!=='unknown'){const note=document.createElement('p');note.className='public-photo-info-dialog__note';note.textContent='파일 정보만으로 실제 HDR 지원 여부를 확정할 수 없습니다.';content.append(note)}
}
async function openInfo(image,index,button){
  if(document.querySelector('dialog[open]'))return;
  opener=button;const version=++requestVersion;title.textContent=(index+1)+'번 사진 정보';message('사진 정보를 확인하고 있습니다.');
  dialog.showModal();close.focus({preventScroll:true});
  const path=sourcePath(image);
  if(!path){message('외부 사진의 파일 정보는 확인할 수 없습니다.');return}
  try{
    if(!cache.has(path)){
      const pending=fetch('/api/photo-info?path='+encodeURIComponent(path),{credentials:'same-origin',headers:{accept:'application/json'}}).then(async response=>{if(!response.ok)throw new Error('unavailable');const payload=await response.json();if(!payload.info||typeof payload.info!=='object')throw new Error('unavailable');return payload.info});
      cache.set(path,pending);pending.catch(()=>{if(cache.get(path)===pending)cache.delete(path)});
    }
    const info=await cache.get(path);if(dialog.open&&version===requestVersion)renderInfo(info,image);
  }catch{if(dialog.open&&version===requestVersion)message('사진 정보를 불러오지 못했습니다. 잠시 뒤 다시 열어 주세요.')}
}
const controls=photos.map((image,index)=>{
  const button=document.createElement('button');button.type='button';button.className='public-photo-info-button';button.textContent='사진 정보';button.setAttribute('aria-label',(index+1)+'번 사진 정보');button.setAttribute('aria-haspopup','dialog');button.setAttribute('aria-controls',dialog.id);
  button.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();openInfo(image,index,button)});layer.append(button);return{image,button};
});
function position(){
  frame=0;
  for(const {image,button} of controls){
    const rect=image.getBoundingClientRect();button.hidden=!image.isConnected||rect.width<=0||rect.height<=0;
    if(button.hidden)continue;
    const compact=rect.width<104,width=compact?44:82;button.textContent=compact?'정보':'사진 정보';button.style.width=width+'px';
    button.style.left=Math.max(0,window.scrollX+rect.right-width-Math.min(8,rect.width/20))+'px';
    button.style.top=Math.max(0,window.scrollY+rect.top+Math.min(8,rect.height/20))+'px';
  }
}
function schedule(){if(!frame)frame=window.requestAnimationFrame(position)}
function restore(){requestVersion++;const target=opener;opener=null;if(target&&target.isConnected&&!target.hidden)target.focus({preventScroll:true})}
close.addEventListener('click',()=>dialog.close());
dialog.addEventListener('cancel',event=>{event.preventDefault();event.stopPropagation();dialog.close()});
dialog.addEventListener('close',restore);
dialog.addEventListener('click',event=>{if(event.target!==dialog)return;const rect=dialog.getBoundingClientRect();if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)dialog.close()});
dialog.addEventListener('keydown',event=>{event.stopPropagation();if(event.key==='Escape'){event.preventDefault();dialog.close()}});
window.addEventListener('resize',schedule,{passive:true});window.addEventListener('load',schedule,{once:true});
body.addEventListener('load',schedule,true);
if(typeof ResizeObserver==='function'){const observer=new ResizeObserver(schedule);observer.observe(body);for(const image of photos)observer.observe(image)}
if(document.fonts&&document.fonts.ready)document.fonts.ready.then(schedule);
position();
})();`;
