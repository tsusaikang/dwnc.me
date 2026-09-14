// Semantic sizes are relative to the article base. Existing inline px values
// remain author choices and are never migrated into these presets.
export const BODY_TYPOGRAPHY_CSS = String.raw`
.prose,.html-editor{--dwnc-body-size:18px;--dwnc-text-size-1:calc(var(--dwnc-body-size)*0.625);--dwnc-text-size-2:calc(var(--dwnc-body-size)*0.8125);--dwnc-text-size-3:var(--dwnc-body-size);--dwnc-text-size-4:calc(var(--dwnc-body-size)*1.125);--dwnc-text-size-5:calc(var(--dwnc-body-size)*1.5);--dwnc-text-size-6:calc(var(--dwnc-body-size)*2);--dwnc-text-size-7:calc(var(--dwnc-body-size)*3);font-size:var(--dwnc-body-size)}
:where(.prose,.html-editor) h2{font-size:calc(var(--dwnc-body-size)*2)}
:where(.prose,.html-editor) h3{font-size:calc(var(--dwnc-body-size)*1.5)}
:where(.prose,.html-editor) h4{font-size:calc(var(--dwnc-body-size)*1.2)}
:is(.prose,.html-editor) [data-ke-size="size14"]{font-size:calc(var(--dwnc-body-size)*0.875)}
:is(.prose,.html-editor) [data-ke-size="size16"]{font-size:var(--dwnc-body-size)}
:is(.prose,.html-editor) [data-ke-size="size18"]{font-size:calc(var(--dwnc-body-size)*1.125)}
:is(.prose,.html-editor) [data-ke-size="size20"]{font-size:calc(var(--dwnc-body-size)*1.25)}
:is(.prose,.html-editor) [data-ke-size="size23"]{font-size:calc(var(--dwnc-body-size)*1.4375)}
:is(.prose,.html-editor) [data-ke-size="size26"]{font-size:calc(var(--dwnc-body-size)*1.625)}
`;

export const FONT_SIZE_PRESET_OPTIONS = '<option value="1">아주 작게</option><option value="2">작게</option><option value="3" selected>보통</option><option value="4">조금 크게</option><option value="5">크게</option><option value="6">더 크게</option><option value="7">아주 크게</option>';

export const fontSizePresetScript = String.raw`
function sizePresetValue(preset){return /^[1-7]$/.test(String(preset))?'var(--dwnc-text-size-'+preset+')':null}
function discardPendingFontSizeAfterMove(){
  const caret=pendingFontSpans?.caret;if(!caret)return;
  const range=bodyRange();
  if(!range||!range.collapsed||range.startContainer!==caret.node||range.startOffset!==caret.offset)pendingFontSpans=null;
}
function applySelectedTextSize(range,preset){
  const value=sizePresetValue(preset);if(!value||range.collapsed)return false;
  const walker=document.createTreeWalker($('bodyHtml'),NodeFilter.SHOW_TEXT),parts=[];
  for(let node=walker.nextNode();node;node=walker.nextNode())if(range.intersectsNode(node)){
    const start=node===range.startContainer?range.startOffset:0,end=node===range.endContainer?range.endOffset:node.length;
    if(end>start)parts.push({node,start,end});
  }
  if(!parts.length)return false;
  const selected=[];
  for(const part of parts.reverse()){
    let node=part.node;if(part.end<node.length)node.splitText(part.end);if(part.start)node=node.splitText(part.start);
    const parent=node.parentElement;
    if(parent.tagName==='SPAN'&&parent.childNodes.length===1)parent.style.setProperty('font-size',value,'important');
    else{const span=document.createElement('span');span.style.setProperty('font-size',value,'important');node.replaceWith(span);span.append(node)}
    selected.unshift(node);
  }
  const restored=document.createRange();restored.setStart(selected[0],0);restored.setEnd(selected.at(-1),selected.at(-1).length);
  const selection=window.getSelection();selection.removeAllRanges();selection.addRange(restored);formatRange=restored.cloneRange();return true;
}
function applyFontSizePreset(preset){
  if(busy||!current||!textFormattingAvailable()||!sizePresetValue(preset))return false;
  const range=restoreFormatRange();captureEditorBefore();editorTyping=null;pendingFontSpans=null;
  if(!range.collapsed){const changed=applySelectedTextSize(range,preset);if(changed)schedule();updateFormatState();return changed}
  const element=range.startContainer.nodeType===1?range.startContainer:range.startContainer.parentElement;
  const actual=window.getComputedStyle(element).fontSize,before=new Map(Array.from($('bodyHtml').querySelectorAll('span[style]'),span=>[span,span.style.fontSize]));
  // Use a different native typing size so inserted text is identifiable without
  // rewriting an existing px-sized ancestor or inserting invisible characters.
  document.execCommand('styleWithCSS',false,true);document.execCommand('fontSize',false,actual==='48px'?'1':'7');
  const caret=bodyRange()||range;
  pendingFontSpans={before,preset,caret:{node:caret.startContainer,offset:caret.startOffset}};$('fontSize').value=String(preset);captureFormatRange();return true;
}
`;
