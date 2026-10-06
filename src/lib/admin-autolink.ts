// Browser source stays literal so bundling cannot introduce helper references.
// Provenance is session-local: reopening, saving, or merely adding a delimiter
// beside an old URL never makes that old URL eligible for automatic linking.
export const autoLinkScript = String.raw`
let autoCardEligible=new WeakMap(),autoCardLooseNode=null;
let autoLinkFresh=[],autoLinkBefore=null,autoLinkComposing=false,autoLinkText=null,autoLinkPaste=null,autoLinkComposition=null;
const autoLinkBlocks=new Set(['P','DIV','H1','H2','H3','H4','H5','H6','LI','BLOCKQUOTE','PRE','TD','TH']);
function autoLinkSnapshot(){
  const root=$('bodyHtml'),nodes=new Map(),texts=[];let text='';
  function visit(node){
    if(node.nodeType===3){const start=text.length;text+=node.data;const entry={node,start,end:text.length};nodes.set(node,entry);texts.push(entry);return}
    if(node.nodeType!==1)return;
    const block=node!==root&&autoLinkBlocks.has(node.tagName);if(block&&text&&!text.endsWith('\n'))text+='\n';
    const entry={node,start:text.length,end:text.length};nodes.set(node,entry);
    if(node.tagName==='BR')text+='\n';else for(const child of node.childNodes)visit(child);
    entry.end=text.length;if(block&&!text.endsWith('\n'))text+='\n';
  }
  visit(root);return{text,nodes,texts};
}
function autoLinkOffset(snapshot,node,offset){const entry=snapshot.nodes.get(node);if(!entry)return null;if(node.nodeType===3)return entry.start+Math.min(offset,node.data.length);const child=node.childNodes[offset];return child?snapshot.nodes.get(child)?.start??entry.end:entry.end}
function autoLinkPoint(snapshot,offset,end=false){
  const entries=snapshot.texts;for(const entry of entries){if(end?offset>entry.start&&offset<=entry.end:offset>=entry.start&&offset<entry.end)return[entry.node,offset-entry.start]}
  // A caret beyond a line break has no text node at its offset. Retain that
  // DOM boundary instead of falling back into the preceding URL's text.
  for(const [node,entry] of snapshot.nodes)if(node.nodeType===1&&node.tagName==='BR'&&node.parentNode){const index=Array.prototype.indexOf.call(node.parentNode.childNodes,node);if(offset===entry.start)return[node.parentNode,index];if(offset===entry.end)return[node.parentNode,index+1]}
  for(const entry of entries){if(entry.start>=offset)return[entry.node,0]}const last=entries.at(-1);return last?[last.node,last.node.data.length]:[$('bodyHtml'),0];
}
function resetAutoLinks(){autoCardEligible=new WeakMap();autoCardLooseNode=null;autoLinkFresh=[];autoLinkBefore=null;autoLinkComposing=false;autoLinkText=null;autoLinkPaste=null;autoLinkComposition=null}
function autoLinkMerge(ranges){const result=[];for(const range of ranges.filter(([a,b])=>b>a).sort((a,b)=>a[0]-b[0])){const previous=result.at(-1);if(previous&&range[0]<=previous[1])previous[1]=Math.max(previous[1],range[1]);else result.push([...range])}return result}
function autoLinkEdit(ranges,start,end,insertLength){const shift=insertLength-(end-start),next=[];for(const [a,b] of ranges){if(a<start)next.push([a,Math.min(b,start)]);if(b>end)next.push([Math.max(a,end)+shift,b+shift])}if(insertLength)next.push([start,start+insertLength]);return autoLinkMerge(next)}
function autoLinkMatches(text){
  const matches=[],pattern=/(?:https?:\/\/|www\.)[^\s<>"'\u200B-\u200D\uFEFF]+/gi;
  for(const match of text.matchAll(pattern)){
    const start=match.index,previous=text[start-1]||'';if(/[\p{L}\p{N}_@/]/u.test(previous))continue;
    let label=match[0].replace(/[.,!?;:。！？、，；：”’」』】》〉]+$/u,'');
    const depth={'(':0,'[':0,'{':0},closing={')':'(',']':'[','}':'{'};for(let index=0;index<label.length;index++){const char=label[index];if(char in depth)depth[char]++;else if(char in closing){const open=closing[char];if(!depth[open]){label=label.slice(0,index);break}depth[open]--}}
    label=label.replace(/[.,!?;:。！？、，；：”’」』】》〉]+$/u,'');
    try{const href=/^www\./i.test(label)?'https://'+label:label,url=new URL(href),authority=href.replace(/^https?:\/\//i,'').split(/[/?#]/u)[0],lastLabel=authority.replace(/:\d+$/u,'').split('.').at(-1)||'';if(!['https:','http:'].includes(url.protocol)||!url.hostname.includes('.')||url.username||url.password||/[a-z]/i.test(lastLabel)&&/[^\x00-\x7f]/u.test(lastLabel))continue;matches.push({start,end:start+label.length,label,href})}catch{}
  }
  return matches;
}
function autoLinkAllowed(snapshot,match){return autoLinkFresh.some(([a,b])=>a<=match.start&&b>=match.end)&&snapshot.texts.filter(entry=>entry.end>match.start&&entry.start<match.end).every(entry=>!entry.node.parentElement?.closest('a,code,pre,[data-dwnc-no-autolink], [contenteditable="false"]'))}
function autoLinkRestore(snapshot,start,end){if(start===null||end===null)return;const range=document.createRange(),a=autoLinkPoint(snapshot,start),b=autoLinkPoint(snapshot,end,true);try{range.setStart(...a);range.setEnd(...b);if(start===end){const link=b[0].parentElement?.closest('a');if(link&&snapshot.nodes.get(link)?.end===end){range.setStartAfter(link);range.collapse(true)}}const selection=window.getSelection();selection.removeAllRanges();selection.addRange(range);captureFormatRange()}catch{}}
function autoLinkApply(){
  const snapshot=autoLinkSnapshot(),selection=bodyRange(),start=selection?autoLinkOffset(snapshot,selection.startContainer,selection.startOffset):null,end=selection?autoLinkOffset(snapshot,selection.endContainer,selection.endOffset):null;
  const matches=autoLinkMatches(snapshot.text).filter(match=>autoLinkAllowed(snapshot,match));
  const preserved=selection&&!matches.some(match=>start<=match.end&&end>=match.start)?selection.cloneRange():null;
  for(const match of matches.reverse()){
    const range=document.createRange(),a=autoLinkPoint(snapshot,match.start),b=autoLinkPoint(snapshot,match.end,true);range.setStart(...a);range.setEnd(...b);
    const link=document.createElement('a');link.setAttribute('href',match.href);link.setAttribute('target','_blank');link.setAttribute('rel','noopener noreferrer');link.append(range.extractContents());range.insertNode(link);
  }
  autoCardQueue();
  if(matches.length){if(preserved){const live=window.getSelection();live.removeAllRanges();live.addRange(preserved);captureFormatRange()}else autoLinkRestore(autoLinkSnapshot(),start,end);editorTyping=null;rememberEditorChange()}
}
function autoLinkReleaseSpace(){
  const range=bodyRange();if(!range?.collapsed)return;const snapshot=autoLinkSnapshot(),offset=autoLinkOffset(snapshot,range.endContainer,range.endOffset);
  for(const span of $('bodyHtml').querySelectorAll('span[data-dwnc-no-autolink]')){
    if(!span.textContent.trim()){span.removeAttribute('data-dwnc-no-autolink');continue}
    const tail=span.textContent.match(/\s+$/u)?.[0];if(!tail||snapshot.nodes.get(span)?.end!==offset||!span.contains(range.endContainer))continue;
    const cut=document.createRange(),point=autoLinkPoint(snapshot,offset-tail.length);cut.setStart(...point);cut.setEnd(span,span.childNodes.length);cut.deleteContents();const space=document.createTextNode(tail);span.after(space);range.setStart(space,tail.length);range.collapse(true);const selection=window.getSelection();selection.removeAllRanges();selection.addRange(range);captureFormatRange();
  }
}
function removeEditorLink(link){
  if(busy||!link||!$('bodyHtml').contains(link))return;restoreFormatRange();captureEditorBefore();editorTyping=null;
  const existing=link.parentElement?.matches('span[data-dwnc-no-autolink]')?link.parentElement:null,span=existing||document.createElement('span');
  if(existing)link.replaceWith(...link.childNodes);else{span.setAttribute('data-dwnc-no-autolink','true');while(link.firstChild)span.append(link.firstChild);link.replaceWith(span)}
  const range=document.createRange();range.selectNodeContents(span);const selection=window.getSelection();selection.removeAllRanges();selection.addRange(range);captureFormatRange();resetAutoLinks();schedule();
}
// Preview eligibility follows explicitly pasted or Enter-confirmed URL lines.
// Merely opening a document never changes its existing content.
const autoCardPending=new WeakMap(),autoCardJobs=[];let autoCardActive=0;
function autoCardEditBlock(node){const block=node?.nodeType===1?node:node?.parentElement;return block?.closest?.('p,div')}
function autoCardMark(block,href){if(!href)return;let eligible=autoCardEligible.get(block);if(!eligible){eligible=new Set();autoCardEligible.set(block,eligible)}eligible.add(href)}
function autoCardPreview(block,href){
  for(let next=block.nextElementSibling;next?.matches('figure[data-ke-type="opengraph"]');next=next.nextElementSibling){const target=next.getAttribute('data-og-url')||next.querySelector('a[href]')?.getAttribute('href');try{if(new URL(target,location.origin).href===new URL(href).href)return next}catch{}}
  return null;
}
function autoCardHasPreview(block,href){return !!autoCardPreview(block,href)}
function autoCardPreviousPreview(block){return autoCardCandidates(block).map(({href,start})=>({block,href,start,card:autoCardPreview(block,href)})).filter(item=>item.card)}
function autoCardKeepAdjacent(previous){
  // Native Enter can insert its empty typing paragraph between the URL block
  // and existing cards. Move only those known cards across that new empty gap;
  // keep the paragraph and its live caret available for the next input.
  let anchor=null,saved=null,moved=false;
  for(const item of previous||[]){
    if(!$('bodyHtml').contains(item.card)||!autoCardCandidates(item.block).some(candidate=>candidate.href===item.href))continue;
    if(!anchor)anchor=item.block;let next=anchor.nextElementSibling;
    while(next&&next!==item.card&&next.matches('p,div')&&!next.textContent.trim()&&!next.querySelector('img,figure,video,audio,iframe,hr,table,ul,ol,pre,code,[contenteditable="false"],[data-dwnc-no-autolink]'))next=next.nextElementSibling;
    if(next!==item.card)continue;
    if(anchor.nextElementSibling!==item.card){if(!saved)saved=bodyRange()?.cloneRange();anchor.after(item.card);moved=true}anchor=item.card;
  }
  if(moved&&saved){const live=window.getSelection();live.removeAllRanges();live.addRange(saved);captureFormatRange()}
}
function autoCardRemoveStale(previous){for(const item of previous||[])if($('bodyHtml').contains(item.card)&&!autoCardCandidates(item.block).some(candidate=>candidate.href===item.href)){item.card.remove();for(const candidate of autoCardLines(item.block,false))if(candidate.start===item.start)autoCardMark(item.block,candidate.href)}}
function autoCardLines(block,checkHref=true){
  let text='';const links=[];
  function visit(node){if(node.nodeType===3){text+=node.data;return}if(node.nodeType!==1)return;if(node.tagName==='BR'){text+='\n';return}const start=text.length;for(const child of node.childNodes)visit(child);if(node.tagName==='A')links.push({node,start,end:text.length,href:node.getAttribute('href')})}
  visit(block);const candidates=[];let offset=0;
  for(const line of text.split('\n')){const label=line.trim(),matches=autoLinkMatches(label),start=offset+line.indexOf(label),end=start+label.length;if(matches.length===1&&matches[0].label===label){const href=matches[0].href,overlaps=links.filter(link=>link.end>start&&link.start<end);if(!checkHref||overlaps.every(link=>{try{return new URL(link.href,location.origin).href===new URL(href).href}catch{return false}}))candidates.push({href,label,start,end,lineEnd:offset+line.length,anchors:overlaps.map(link=>link.node)})}offset+=line.length+1}
  return candidates;
}
function autoCardCandidates(block){
  const root=$('bodyHtml');
  if(!block||block===root||!block.matches('p,div')||!root.contains(block)||block.closest('figure,pre,code,li,blockquote,table,h1,h2,h3,h4,h5,h6,[contenteditable="false"],[data-dwnc-no-autolink],.se_oglink,.se-oglink'))return [];
  if(block.querySelector('p,div,figure,pre,code,ul,ol,li,blockquote,table,img,video,audio,iframe,hr,[contenteditable="false"],[data-dwnc-no-autolink]'))return [];
  return autoCardLines(block);
}
function autoCardCandidate(block){const candidates=autoCardCandidates(block);return candidates.length===1?candidates[0].href:null}
function autoCardEditableLinks(block,snapshot=null,start=null,end=null){
  if(!block?.querySelectorAll)return [];const result=[];
  for(const line of autoCardLines(block,false))if(line.anchors.length===1&&(!snapshot||snapshot.nodes.get(block)&&end>=snapshot.nodes.get(block).start+line.start&&start<=snapshot.nodes.get(block).start+line.lineEnd)){const link=line.anchors[0],label=link.textContent.trim(),matches=autoLinkMatches(label);try{const href=new URL(link.getAttribute('href'),location.origin).href;if(href===new URL(line.href).href||matches.length===1&&matches[0].label===label&&href===new URL(matches[0].href).href)result.push(link)}catch{}}
  return result;
}
function autoCardRefreshEditedLink(block,intents=autoCardEditableLinks(block)){
  if(!block?.querySelectorAll||!intents.length||block.closest('figure,pre,code,[contenteditable="false"],[data-dwnc-no-autolink]')||block.querySelector('p,div,figure,pre,code,ul,ol,table,img,video,iframe,[data-dwnc-no-autolink]'))return;
  const lines=autoCardLines(block,false).filter(line=>line.anchors.length===1&&intents.includes(line.anchors[0]));
  if(!lines.length)return;
  const snapshot=autoLinkSnapshot(),entry=snapshot.nodes.get(block),selection=bodyRange(),start=selection?autoLinkOffset(snapshot,selection.startContainer,selection.startOffset):null,end=selection?autoLinkOffset(snapshot,selection.endContainer,selection.endOffset):null;
  const spans=lines.filter(line=>line.anchors[0].textContent.trim()!==line.label),saved=selection&&entry&&!spans.some(line=>start<=entry.start+line.end&&end>=entry.start+line.start)?selection.cloneRange():null;let repaired=false;
  for(const line of lines.reverse()){
    const link=line.anchors[0];link.setAttribute('href',line.href);
    if(link.textContent.trim()===line.label||!entry)continue;
    // Only this URL line is collected into its existing anchor. Range preserves
    // inline elements while the surrounding prose, BRs and spaces stay outside.
    link.replaceWith(...link.childNodes);const currentSnapshot=autoLinkSnapshot(),range=document.createRange();range.setStart(...autoLinkPoint(currentSnapshot,entry.start+line.start));range.setEnd(...autoLinkPoint(currentSnapshot,entry.start+line.end,true));const container=range.commonAncestorContainer;let branch=container?.nodeType===1&&range.startContainer!==container?range.startContainer:null;if(branch)while(branch.parentNode&&branch.parentNode!==container)branch=branch.parentNode;link.append(range.extractContents());if(branch?.parentNode===container)branch.after(link);else range.insertNode(link);repaired=true;
  }
  if(repaired&&selection){if(saved){const live=window.getSelection();live.removeAllRanges();live.addRange(saved);captureFormatRange()}else autoLinkRestore(autoLinkSnapshot(),start,end)}
}
function autoCardMarkPaste(before){
  for(const block of $('bodyHtml').querySelectorAll('p,div')){
    const oldHtml=before.get(block);if(oldHtml===block.outerHTML)continue;
    let old=[];if(oldHtml){const template=document.createElement('template');template.innerHTML=oldHtml;const previous=template.content.firstElementChild;if(previous)old=autoCardLines(previous)}
    for(const candidate of autoCardCandidates(block))if(!old.some(item=>item.href===candidate.href))autoCardMark(block,candidate.href);
  }
}
function autoCardDrain(){while(autoCardActive<3&&autoCardJobs.length){const [block,href,token]=autoCardJobs.shift();autoCardActive++;void autoCardResolve(block,href,token).finally(()=>{autoCardActive--;autoCardDrain()})}}
function autoCardWrapLoose(){
  const root=$('bodyHtml'),snapshot=autoLinkSnapshot(),selection=bodyRange(),start=selection?autoLinkOffset(snapshot,selection.startContainer,selection.startOffset):null,end=selection?autoLinkOffset(snapshot,selection.endContainer,selection.endOffset):null,saved=selection?.cloneRange();let run=[],wrapped=false,movedSelection=false;
  function wrap(){
    if(!run.length)return;const text=run.map(node=>node.textContent).join(''),label=text.trim(),match=autoLinkMatches(label);
    const entry=snapshot.nodes.get(run[0]),start=(entry?.start??-100000)+text.indexOf(label);
    if(match.length===1&&match[0].label===label&&(run.some(node=>node===autoCardLooseNode||node.contains?.(autoCardLooseNode))||autoLinkFresh.some(([a,b])=>a<=start&&b>=start+label.length))){
      if(selection){const first=Array.prototype.indexOf.call(root.childNodes,run[0]),last=Array.prototype.indexOf.call(root.childNodes,run.at(-1));for(const [container,offset] of [[selection.startContainer,selection.startOffset],[selection.endContainer,selection.endOffset]])if(run.some(node=>node===container||node.contains?.(container))||container===root&&offset>first&&offset<=last)movedSelection=true}
      const paragraph=document.createElement('p');run[0].before(paragraph);for(const node of run)paragraph.append(node);autoCardMark(paragraph,match[0].href);wrapped=true;
    }run=[];
  }
  for(const node of [...root.childNodes]){if(node.nodeType===3||node.nodeType===1&&node.matches('a,span,strong,b,em,i,u,s,font'))run.push(node);else wrap()}wrap();autoCardLooseNode=null;if(wrapped){if(saved&&!movedSelection){const live=window.getSelection();live.removeAllRanges();live.addRange(saved);captureFormatRange()}else autoLinkRestore(autoLinkSnapshot(),start,end)};
}
function autoCardQueue(){
  autoCardWrapLoose();
  const snapshot=autoLinkSnapshot();
  for(const block of $('bodyHtml').querySelectorAll('p,div')){
    const entry=snapshot.nodes.get(block);if(!entry)continue;
    for(const candidate of autoCardCandidates(block)){
      const {href}=candidate,start=entry.start+candidate.start,end=entry.start+candidate.end;
      if(autoCardPending.get(block)?.has(href)||autoCardHasPreview(block,href))continue;
      if(!autoCardEligible.get(block)?.has(href)&&!autoLinkFresh.some(([a,b])=>a<=start&&b>=end))continue;
      autoCardMark(block,href);const token={html:block.outerHTML,postId:current.id};let pending=autoCardPending.get(block);if(!pending){pending=new Map();autoCardPending.set(block,pending)}pending.set(href,token);autoCardJobs.push([block,href,token]);autoCardDrain();
    }
  }
}
async function autoCardResolve(block,href,token){
  try{
    if(current?.id!==token.postId||!$('bodyHtml').contains(block)||block.outerHTML!==token.html)return;
    const result=await api('/link-preview',{method:'POST',body:JSON.stringify({url:href})});
    if(busy||editorComposing||current?.id!==token.postId||!$('bodyHtml').contains(block)||block.outerHTML!==token.html||!autoCardCandidates(block).some(candidate=>candidate.href===href)||autoCardHasPreview(block,href)||typeof result.html!=='string')return;
    const template=document.createElement('template');template.innerHTML=result.html;const card=template.content.firstElementChild;
    if(!card?.matches('figure[data-ke-type="opengraph"]')||template.content.childElementCount!==1)return;
    for(const name of ['dir','lang'])if(block.hasAttribute(name))card.setAttribute(name,block.getAttribute(name));
    const selection=bodyRange(),inside=selection&&(block.contains(selection.startContainer)||block.contains(selection.endContainer));
    // Keep the URL and current caret; the preview is an adjacent block.
    if(inside&&!selection.collapsed)return;
    const focused=$('bodyHtml').contains(document.activeElement)||document.activeElement===$('bodyHtml');
    const saved=selection?.cloneRange();commitEditorHistory();captureEditorBefore();editorTyping=null;let previous=block;const candidates=autoCardCandidates(block),index=candidates.findIndex(candidate=>candidate.href===href);
    for(const candidate of candidates.slice(0,index)){const existing=autoCardPreview(block,candidate.href);if(existing)previous=existing}
    previous.after(card);autoCardEligible.get(block)?.delete(href);
    if(saved&&focused){const live=window.getSelection();live.removeAllRanges();live.addRange(saved);captureFormatRange()}
    autoLinkFresh=[];autoLinkText=null;schedule();
  }catch{/* Metadata failures keep the usable original link. */}
  finally{const pending=autoCardPending.get(block);if(pending?.get(href)===token){pending.delete(href);if(!pending.size)autoCardPending.delete(block)}if(current?.id===token.postId&&autoCardEligible.get(block)?.has(href)&&block.outerHTML!==token.html)autoCardQueue()}
}
$('bodyHtml').addEventListener('paste',event=>{
  autoLinkPaste=null;if(event.defaultPrevented||busy||!current||event.clipboardData?.files?.length)return;const plain=event.clipboardData?.getData('text/plain')||'';if(plain&&autoLinkMatches(plain).length){const snapshot=autoLinkSnapshot(),range=bodyRange(),a=range?autoLinkOffset(snapshot,range.startContainer,range.startOffset):0,b=range?autoLinkOffset(snapshot,range.endContainer,range.endOffset):0;autoLinkPaste={plain:plain.replace(/\r\n?/g,'\n'),postId:current.id,baseLength:snapshot.text.length,selectionLength:Math.max(0,(b??0)-(a??0)),blocks:new Map([...$('bodyHtml').querySelectorAll('p,div')].map(block=>[block,block.outerHTML]))}};
});
$('bodyHtml').addEventListener('beforeinput',event=>{
  autoLinkBefore=null;if(busy||!current||!['insertText','insertCompositionText','insertFromPaste','insertParagraph','insertLineBreak','deleteContentBackward','deleteContentForward','deleteByCut'].includes(event.inputType))return;
  const snapshot=autoLinkSnapshot(),range=bodyRange();if(autoLinkText!==snapshot.text)autoLinkFresh=[];if(!range)return;
  autoLinkBefore={snapshot,start:autoLinkOffset(snapshot,range.startContainer,range.startOffset),end:autoLinkOffset(snapshot,range.endContainer,range.endOffset),type:event.inputType,data:event.data||'',block:autoCardEditBlock(range.startContainer),node:range.startContainer,preview:autoCardPreviousPreview(autoCardEditBlock(range.startContainer)),links:autoCardEditableLinks(autoCardEditBlock(range.startContainer),snapshot,autoLinkOffset(snapshot,range.startContainer,range.startOffset),autoLinkOffset(snapshot,range.endContainer,range.endOffset)),confirmed: (()=>{const block=autoCardEditBlock(range.startContainer),entry=snapshot.nodes.get(block),offset=autoLinkOffset(snapshot,range.startContainer,range.startOffset);return entry&&offset!==null?autoCardLines(block,false).find(candidate=>offset>=entry.start+candidate.end&&offset<=entry.start+candidate.lineEnd)?.href:null})()};
});
$('bodyHtml').addEventListener('input',event=>{
  const before=autoLinkBefore,pasted=autoLinkPaste;autoLinkBefore=null;autoLinkPaste=null;if(busy||!current)return;
  if(before?.block&&!autoLinkComposing&&!event.isComposing)autoCardRefreshEditedLink(before.block,before.links);
  autoCardRemoveStale(before?.preview);
  if(before?.block&&['insertParagraph','insertLineBreak'].includes(before.type)){if(before.block===$('bodyHtml'))autoCardLooseNode=before.node;if(before.type==='insertParagraph')autoCardKeepAdjacent(before.preview);autoCardMark(before.block,before.confirmed)}
  if(pasted?.postId===current.id){autoCardMarkPaste(pasted.blocks);Promise.resolve().then(()=>autoCardQueue())}
  // Native paste may replace an empty block's BR or normalize DIV/P wrappers.
  // The clipboard text immediately before the resulting caret identifies only
  // the inserted span, even when those browser changes invalidate a full diff.
  if(pasted?.postId===current.id&&(event.inputType==='insertFromPaste'||event.inputType==='insertText'||event.inputType==='')&&!autoLinkComposing&&!event.isComposing){
    const snapshot=autoLinkSnapshot(),range=bodyRange(),end=range?autoLinkOffset(snapshot,range.endContainer,range.endOffset):null,plain=pasted.plain.replace(/\u00a0/g,' ');
    if(end!==null&&snapshot.text.length-pasted.baseLength+pasted.selectionLength>=plain.length)for(const finish of [end,end-1]){const start=finish-plain.length;if(start>=0&&snapshot.text.slice(start,finish).replace(/\u00a0/g,' ')===plain){autoLinkFresh=[[start,finish]];autoLinkText=snapshot.text;autoLinkApply();return}}
  }
  if(!before)return;
  const snapshot=autoLinkSnapshot(),{start,end}=before;autoLinkText=snapshot.text;if(start===null||end===null){autoLinkFresh=[];return}
  let a=start,b=end;const prefix=before.snapshot.text.slice(0,a),suffix=before.snapshot.text.slice(b);
  if(!snapshot.text.startsWith(prefix)||!snapshot.text.endsWith(suffix)||snapshot.text.length<prefix.length+suffix.length){
    // Deletion events have a collapsed selection, so derive their deleted span.
    // For browser-normalized insertion, discard provenance instead of touching old text.
    if(!before.type.startsWith('delete')){autoLinkFresh=[];if(['insertParagraph','insertLineBreak'].includes(before.type))autoCardQueue();return}
    a=0;while(a<before.snapshot.text.length&&a<snapshot.text.length&&before.snapshot.text[a]===snapshot.text[a])a++;
    b=before.snapshot.text.length;let tail=snapshot.text.length;while(b>a&&tail>a&&before.snapshot.text[b-1]===snapshot.text[tail-1]){b--;tail--}
  }
  const length=snapshot.text.length-(before.snapshot.text.length-(b-a));autoLinkFresh=autoLinkEdit(autoLinkFresh,a,b,Math.max(0,length));
  if(!autoLinkComposing&&!event.isComposing)autoLinkReleaseSpace();
  if(!autoLinkComposing&&!event.isComposing&&(before.type==='insertFromPaste'||before.type==='insertParagraph'||before.type==='insertLineBreak'||before.type==='insertText'&&/\s/u.test(before.data)))autoLinkApply();
});
$('bodyHtml').addEventListener('compositionstart',()=>{autoLinkComposing=true;const snapshot=autoLinkSnapshot(),text=snapshot.text,range=bodyRange(),block=autoCardEditBlock(range?.startContainer);autoLinkComposition={text,fresh:autoLinkText===text?autoLinkFresh.map(range=>[...range]):[],postId:current?.id,block,links:range?autoCardEditableLinks(block,snapshot,autoLinkOffset(snapshot,range.startContainer,range.startOffset),autoLinkOffset(snapshot,range.endContainer,range.endOffset)):[]}});
$('bodyHtml').addEventListener('compositionend',()=>{
  autoLinkComposing=false;const before=autoLinkComposition;autoLinkComposition=null;autoLinkBefore=null;if(!before||before.postId!==current?.id)return;
  if(before.block)autoCardRefreshEditedLink(before.block,before.links);
  const text=autoLinkSnapshot().text;let start=0,end=before.text.length,tail=text.length;
  while(start<end&&start<tail&&before.text[start]===text[start])start++;
  while(end>start&&tail>start&&before.text[end-1]===text[tail-1]){end--;tail--}
  autoLinkFresh=autoLinkEdit(before.fresh,start,end,tail-start);autoLinkText=text;
});
`;
