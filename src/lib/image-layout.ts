// These classes are shared by saved HTML, the editor, preview and public pages.
export const IMAGE_LAYOUT_CLASSES = ['dwnc-image-layout','dwnc-image-item','dwnc-image-caption','dwnc-image-left','dwnc-image-center','dwnc-image-right','dwnc-image-original','dwnc-image-paragraph','dwnc-image-full','dwnc-image-cols-2','dwnc-image-cols-3'];
export const IMAGE_LAYOUT_CSS = String.raw`
:is(.prose,.html-editor) .dwnc-image-layout{display:block;box-sizing:border-box;width:min(100%,var(--reading,720px));max-width:none;margin:24px auto;clear:both;text-align:left}
:is(.prose,.html-editor) .dwnc-image-layout.dwnc-image-full{width:var(--image-layout-full-width,min(1200px,calc(100vw - 44px)));margin-inline:calc((100% - var(--image-layout-full-width,min(1200px,calc(100vw - 44px)))) / 2)}
:is(.prose,.html-editor) .dwnc-image-layout.dwnc-image-original{--dwnc-current-layout-width:min(var(--image-layout-full-width,min(1200px,calc(100vw - 44px))),max(min(100%,var(--reading,720px)),var(--dwnc-original-layout-width,720px)));width:var(--dwnc-current-layout-width);margin-inline:calc((100% - var(--dwnc-current-layout-width)) / 2)}
:is(.prose,.html-editor) .dwnc-image-item{min-width:0;max-width:100%;margin:0;padding:0}
:is(.prose,.html-editor) .dwnc-image-layout .dwnc-image-item :is(figure,div,p,span,a){max-width:100%!important;width:auto!important;margin-inline:0!important;float:none!important}
:is(.prose,.html-editor) .dwnc-image-layout .dwnc-image-item figure{padding:0;border:0;margin-block:0}
:is(.prose,.html-editor) .dwnc-image-layout .dwnc-image-item img{display:block!important;width:100%!important;max-width:100%!important;height:auto!important;object-fit:contain!important;margin:0!important;float:none!important}
:is(.prose,.html-editor) .dwnc-image-original .dwnc-image-item img{width:auto!important}
:is(.prose,.html-editor) .dwnc-image-left .dwnc-image-item img{margin-inline:0 auto!important}
:is(.prose,.html-editor) .dwnc-image-center .dwnc-image-item img{margin-inline:auto!important}
:is(.prose,.html-editor) .dwnc-image-right .dwnc-image-item img{margin-inline:auto 0!important}
:is(.prose,.html-editor) .dwnc-image-layout:is(.dwnc-image-cols-2,.dwnc-image-cols-3){display:grid;gap:12px;align-items:start;grid-template-columns:var(--dwnc-image-columns,repeat(2,minmax(0,1fr)))}
:is(.prose,.html-editor) .dwnc-image-layout.dwnc-image-cols-3{grid-template-columns:var(--dwnc-image-columns,repeat(3,minmax(0,1fr)));--dwnc-image-gaps:2}
:is(.prose,.html-editor) .dwnc-image-layout > .dwnc-image-caption{grid-column:1 / -1;min-width:0;margin:0;text-align:center;font-size:0.9em;line-height:1.6;color:#777;white-space:pre-line}
:is(.prose,.html-editor) .dwnc-image-layout:is(.dwnc-image-cols-2,.dwnc-image-cols-3).dwnc-image-original{--dwnc-current-layout-width:min(var(--image-layout-full-width,min(1200px,calc(100vw - 44px))),calc(var(--dwnc-original-layout-width,720px) - (12px - var(--dwnc-image-gap,12px)) * var(--dwnc-image-gaps,1)));width:var(--dwnc-current-layout-width);margin-inline:calc((100% - var(--dwnc-current-layout-width)) / 2)}
:is(.prose,.html-editor) .dwnc-image-layout:is(.dwnc-image-cols-2,.dwnc-image-cols-3) .dwnc-image-item img{width:100%!important}
.article-page{container-type:inline-size}.article-page .dwnc-image-layout:is(.dwnc-image-cols-2,.dwnc-image-cols-3){--image-layout-full-width:min(1200px,calc(100cqw - 44px))}
.preview-viewport{container-type:inline-size}.preview-viewport .dwnc-image-layout{--image-layout-full-width:100cqw}
.image-layout-dialog{width:min(700px,calc(100vw - 32px));max-height:85vh;overflow:auto;border:1px solid #ccc;border-radius:8px;padding:24px}.image-layout-dialog::backdrop{background:#0005}.image-layout-list{display:grid;grid-template-columns:var(--dwnc-image-columns,repeat(3,minmax(0,1fr)));gap:8px;max-height:36vh;overflow:auto;margin:16px 0}.image-layout-choice{display:flex!important;gap:8px;align-items:center;border:2px solid #ddd;padding:8px;min-width:0}.image-layout-choice:has(:checked){border-color:#1769d2;background:#eef5ff}.image-layout-choice img{width:64px;height:55px;object-fit:contain}.image-layout-choice input{width:auto}.image-layout-dialog select{width:auto}.image-layout-dialog p{font-size:13px}.image-layout-error{color:#a22;min-height:1.4em}
@media(max-width:600px){.image-layout-list{grid-template-columns:var(--dwnc-image-columns,repeat(2,minmax(0,1fr)))}:is(.prose,.html-editor) .dwnc-image-layout:is(.dwnc-image-cols-2,.dwnc-image-cols-3){gap:6px;--dwnc-image-gap:6px}}
`;

// Shared DOM helpers: saved captions belong to the row, never its individual
// cells. Move rich caption contents rather than flattening links/emphasis.
export const IMAGE_LAYOUT_DOM_SCRIPT = String.raw`
function imageLayoutItems(group){return Array.from(group.children).filter(node=>node.matches('.dwnc-image-item'))}
function imageLayoutCaption(group){return Array.from(group.children).find(node=>node.matches('.dwnc-image-caption'))||null}
function appendImageCaptionPart(caption,source){
  const part=document.createElement('div');for(const attr of ['style','lang','dir','align'])if(source.getAttribute(attr))part.setAttribute(attr,source.getAttribute(attr));
  if(!part.style.getPropertyValue('text-align')&&!source.getAttribute('align'))for(const align of ['left','center','right','justify'])if(source.matches('.align'+align[0].toUpperCase()+align.slice(1)+',.se_align-'+align+',.se-text-paragraph-align-'+align))part.style.setProperty('text-align',align);
  part.append(...Array.from(source.childNodes));caption.append(part);
}
function normalizeImageGroupCaption(group){
  const items=imageLayoutItems(group);if(items.length<2)return imageLayoutCaption(group);
  let caption=imageLayoutCaption(group);
  for(const item of items)for(const old of Array.from(item.querySelectorAll('figcaption,.se-caption,.se_mediaCaption'))){
    if(!caption){caption=document.createElement('div');caption.className='dwnc-image-caption';group.append(caption)}
    appendImageCaptionPart(caption,old);old.remove();
  }
  return caption;
}
function imageGroupCaptionText(caption){if(!caption)return'';const text=node=>node.nodeType===3?node.textContent:node.tagName==='BR'?'\n':Array.from(node.childNodes).map(text).join('')+(node!==caption&&node.matches('div,p')?'\n':'');return text(caption).replace(/\n$/,'')}
function imageLayoutMetrics(images){
  const sizes=images.map(image=>({width:image.naturalWidth||Number(image.getAttribute?.('width')),height:image.naturalHeight||Number(image.getAttribute?.('height'))}));
  if(!sizes.length||sizes.some(size=>!(size.width>0&&size.height>0)))return null;
  const ratios=sizes.map(size=>size.width/size.height),height=Math.min(...sizes.map(size=>size.height));
  return{ratios,width:height*ratios.reduce((sum,value)=>sum+value,0)+12*(images.length-1)};
}
function refreshImageGroupGeometry(group,images=Array.from(group.querySelectorAll('img'))){
  const metrics=imageLayoutMetrics(images);
  if(images.length<2){group.style.removeProperty('--dwnc-image-columns');return}
  if(!metrics)return;
  group.style.setProperty('--dwnc-image-columns',metrics.ratios.map(value=>Math.max(0.000001,value).toFixed(6)+'fr').join(' '));
  group.style.setProperty('--dwnc-original-layout-width',Math.max(1,Math.floor(Math.min(1200,metrics.width)))+'px');
}
function refreshImageGroups(root){for(const group of root.querySelectorAll('.dwnc-image-layout')){normalizeImageGroupCaption(group);refreshImageGroupGeometry(group)}}
`;
export const IMAGE_LAYOUT_BOOTSTRAP = '(function(){'+IMAGE_LAYOUT_DOM_SCRIPT+String.raw`
function refresh(){for(const root of document.querySelectorAll('.prose'))refreshImageGroups(root)}
refresh();document.addEventListener('load',event=>{const image=event.target;if(image?.tagName==='IMG'&&image.closest('.prose .dwnc-image-layout'))refreshImageGroupGeometry(image.closest('.dwnc-image-layout'))},true);
})();`;
