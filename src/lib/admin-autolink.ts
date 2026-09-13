// Browser source stays literal so bundling cannot introduce helper references.
// Provenance is session-local: reopening, saving, or merely adding a delimiter
// beside an old URL never makes that old URL eligible for automatic linking.
export const autoLinkScript = String.raw`
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
function autoLinkPoint(snapshot,offset,end=false){const entries=snapshot.texts;for(const entry of entries){if(end?offset>entry.start&&offset<=entry.end:offset>=entry.start&&offset<entry.end)return[entry.node,offset-entry.start]}for(const entry of entries){if(entry.start>=offset)return[entry.node,0]}const last=entries.at(-1);return last?[last.node,last.node.data.length]:[$('bodyHtml'),0]}
function resetAutoLinks(){autoLinkFresh=[];autoLinkBefore=null;autoLinkComposing=false;autoLinkText=null;autoLinkPaste=null;autoLinkComposition=null}
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
$('bodyHtml').addEventListener('paste',event=>{
  autoLinkPaste=null;if(event.defaultPrevented||busy||!current||event.clipboardData?.files?.length)return;const plain=event.clipboardData?.getData('text/plain')||'';if(plain&&autoLinkMatches(plain).length)autoLinkPaste={plain:plain.replace(/\r\n?/g,'\n'),postId:current.id};
});
$('bodyHtml').addEventListener('beforeinput',event=>{
  autoLinkBefore=null;if(busy||!current||!['insertText','insertCompositionText','insertFromPaste','insertParagraph','insertLineBreak','deleteContentBackward','deleteContentForward','deleteByCut'].includes(event.inputType))return;
  const snapshot=autoLinkSnapshot(),range=bodyRange();if(autoLinkText!==snapshot.text)autoLinkFresh=[];if(!range)return;
  autoLinkBefore={snapshot,start:autoLinkOffset(snapshot,range.startContainer,range.startOffset),end:autoLinkOffset(snapshot,range.endContainer,range.endOffset),type:event.inputType,data:event.data||''};
});
$('bodyHtml').addEventListener('input',event=>{
  const before=autoLinkBefore,pasted=autoLinkPaste;autoLinkBefore=null;autoLinkPaste=null;if(busy||!current)return;
  // Native paste may replace an empty block's BR or normalize DIV/P wrappers.
  // The clipboard text immediately before the resulting caret identifies only
  // the inserted span, even when those browser changes invalidate a full diff.
  if(pasted?.postId===current.id&&(event.inputType==='insertFromPaste'||event.inputType==='insertText'&&event.data===pasted.plain)&&!autoLinkComposing&&!event.isComposing){
    const snapshot=autoLinkSnapshot(),range=bodyRange(),end=range?autoLinkOffset(snapshot,range.endContainer,range.endOffset):null,plain=pasted.plain.replace(/\u00a0/g,' ');
    if(end!==null)for(const finish of [end,end-1]){const start=finish-plain.length;if(start>=0&&snapshot.text.slice(start,finish).replace(/\u00a0/g,' ')===plain){autoLinkFresh=[[start,finish]];autoLinkText=snapshot.text;autoLinkApply();return}}
  }
  if(!before)return;
  const snapshot=autoLinkSnapshot(),{start,end}=before;autoLinkText=snapshot.text;if(start===null||end===null){autoLinkFresh=[];return}
  let a=start,b=end;const prefix=before.snapshot.text.slice(0,a),suffix=before.snapshot.text.slice(b);
  if(!snapshot.text.startsWith(prefix)||!snapshot.text.endsWith(suffix)||snapshot.text.length<prefix.length+suffix.length){
    // Deletion events have a collapsed selection, so derive their deleted span.
    // For browser-normalized insertion, discard provenance instead of touching old text.
    if(!before.type.startsWith('delete')){autoLinkFresh=[];return}
    a=0;while(a<before.snapshot.text.length&&a<snapshot.text.length&&before.snapshot.text[a]===snapshot.text[a])a++;
    b=before.snapshot.text.length;let tail=snapshot.text.length;while(b>a&&tail>a&&before.snapshot.text[b-1]===snapshot.text[tail-1]){b--;tail--}
  }
  const length=snapshot.text.length-(before.snapshot.text.length-(b-a));autoLinkFresh=autoLinkEdit(autoLinkFresh,a,b,Math.max(0,length));
  if(!autoLinkComposing&&!event.isComposing)autoLinkReleaseSpace();
  if(!autoLinkComposing&&!event.isComposing&&(before.type==='insertFromPaste'||before.type==='insertParagraph'||before.type==='insertLineBreak'||before.type==='insertText'&&/\s/u.test(before.data)))autoLinkApply();
});
$('bodyHtml').addEventListener('compositionstart',()=>{autoLinkComposing=true;const text=autoLinkSnapshot().text;autoLinkComposition={text,fresh:autoLinkText===text?autoLinkFresh.map(range=>[...range]):[],postId:current?.id}});
$('bodyHtml').addEventListener('compositionend',()=>{
  autoLinkComposing=false;const before=autoLinkComposition;autoLinkComposition=null;autoLinkBefore=null;if(!before||before.postId!==current?.id)return;
  const text=autoLinkSnapshot().text;let start=0,end=before.text.length,tail=text.length;
  while(start<end&&start<tail&&before.text[start]===text[start])start++;
  while(end>start&&tail>start&&before.text[end-1]===text[tail-1]){end--;tail--}
  autoLinkFresh=autoLinkEdit(before.fresh,start,end,tail-start);autoLinkText=text;
});
`;
