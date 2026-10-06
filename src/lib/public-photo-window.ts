import { canonicalPhotoSource } from './photo-media-summary.ts';

// Reuse the media URL policy without introducing a fetch/proxy or another
// access path. Native cache-busting queries still identify the displayed file.
export function photoWindowSource(value: string, base: string): string | null {
  try {
    const url = new URL(value, base);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
    let source = url.href;
    if (url.origin === new URL(base).origin) {
      url.protocol = 'https:'; url.host = 'dwnc.me'; url.port = ''; source = url.href;
    }
    const path = canonicalPhotoSource(source);
    if (!path.startsWith('/media/') || /[\\%]/u.test(path) || path.includes('//')) return null;
    return url.pathname + (path.startsWith('/media/native/') ? url.search : '');
  } catch { return null; }
}

const policy = '\nconst canonicalPhotoSource=' + canonicalPhotoSource.toString() + ';\nconst photoWindowSource=' + photoWindowSource.toString() + ';\n';

export const PUBLIC_PHOTO_WINDOW_BOOTSTRAP = '(function(){' + policy + String.raw`
const body=document.querySelector('.article-page .prose');
if(!body||body.publicPhotoWindowReady)return;
body.publicPhotoWindowReady=true;
const originals=new WeakMap();let fallback=null;
const excluded='a,button,input,select,textarea,[onclick],[contenteditable="true"],[data-ke-type="opengraph"],.se_component.se_oglink,.se-component.se-oglink';
function source(image){return photoWindowSource(image.getAttribute('src')||'',location.href)}
function eligible(image){return Boolean(image&&image.tagName==='IMG'&&body.contains(image)&&!image.closest(excluded)&&source(image)&&(!image.hasAttribute('role')||originals.has(image)))}
function refresh(){
  for(const image of body.querySelectorAll('img')){
    if(eligible(image)){
      if(!originals.has(image))originals.set(image,Object.fromEntries(['role','tabindex','aria-label','data-public-photo-window'].map(name=>[name,image.getAttribute(name)])));
      const attributes={role:'button',tabindex:'0','aria-label':(image.getAttribute('alt')||'사진')+' · 원본 크기로 새 창에서 보기','data-public-photo-window':'true'};
      for(const [name,value] of Object.entries(attributes))if(image.getAttribute(name)!==value)image.setAttribute(name,value);
    }else if(originals.has(image)){
      for(const [name,value] of Object.entries(originals.get(image)))if(value===null)image.removeAttribute(name);else image.setAttribute(name,value);
      originals.delete(image);
    }
  }
}
function openPhoto(image){
  const path=source(image);if(!path)return;
  const url='/photo-viewer?src='+encodeURIComponent(path);
  const width=Math.min(Math.max(320,image.naturalWidth||960),Math.max(320,(window.screen?.availWidth||1280)-80));
  const height=Math.min(Math.max(240,image.naturalHeight||720),Math.max(240,(window.screen?.availHeight||900)-100));
  let popup=null;
  try{
    popup=window.open('about:blank','_blank','popup=yes,width='+width+',height='+height+',resizable=yes,scrollbars=yes,toolbar=no,menubar=no,location=no,status=no');
    if(popup){popup.opener=null;popup.location.replace(url)}
  }catch{try{popup?.close()}catch{}popup=null}
  if(popup){
    fallback?.remove();fallback=null;
  }else{
    fallback?.remove();fallback=document.createElement('aside');fallback.className='public-photo-window-fallback';fallback.setAttribute('aria-label','사진 새 창 안내');
    const text=document.createElement('p');text.textContent='브라우저가 새 창을 차단했습니다.';
    const link=document.createElement('a');link.href=url;link.target='_blank';link.rel='noopener';link.textContent='사진을 새 탭에서 보기';
    fallback.append(text,link);document.body.append(fallback);link.focus({preventScroll:true});
  }
}
function gesture(event){return !event.defaultPrevented&&!event.ctrlKey&&!event.metaKey&&!event.shiftKey&&!event.altKey&&window.getSelection?.()?.isCollapsed!==false}
body.addEventListener('click',event=>{const image=event.target;if(event.button!==0||!gesture(event)||!eligible(image))return;event.preventDefault();openPhoto(image)});
body.addEventListener('keydown',event=>{const image=event.target;if(event.repeat||event.isComposing||event.keyCode===229||!['Enter',' '].includes(event.key)||!gesture(event)||!eligible(image))return;event.preventDefault();openPhoto(image)});
refresh();
if(typeof MutationObserver==='function')new MutationObserver(refresh).observe(body,{subtree:true,childList:true,attributes:true,attributeFilter:['src','href','alt']});
})();`;

export const PHOTO_VIEWER_BOOTSTRAP = '(function(){' + policy + String.raw`
const image=document.getElementById('photo'),status=document.getElementById('status');
const source=photoWindowSource(new URL(location.href).searchParams.get('src')||'',location.href);
if(!source){status.textContent='사진 주소를 확인할 수 없습니다.';return}
image.addEventListener('load',()=>{
  // Explicit CSS dimensions prevent responsive fitting and browser downscaling
  // presentation. The file itself is delivered by the existing media server.
  if(image.naturalWidth>0&&image.naturalHeight>0){image.style.width=image.naturalWidth+'px';image.style.height=image.naturalHeight+'px'}
  status.hidden=true;image.hidden=false;document.title='사진 · '+image.naturalWidth+' × '+image.naturalHeight;
});
image.addEventListener('error',()=>{image.hidden=true;status.hidden=false;status.textContent='사진을 불러오지 못했습니다.'});
image.src=source;
})();`;
