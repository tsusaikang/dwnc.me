import assert from 'node:assert/strict';
import vm from 'node:vm';
import { autoLinkScript } from '../src/lib/admin-autolink.ts';

// Deliberately small DOM adapter: checks qualification and asynchronous stale
// response guards, not browser layout or native selection behavior.
const root={nodeType:1,tagName:'DIV',childNodes:[],addEventListener(){},contains(node){return node?.attached},querySelectorAll(){return []}};
const context=vm.createContext({URL,Map,Set,WeakMap,console,location:{origin:'https://admin.dwnc.me'},$:()=>root});
vm.runInContext('let current={id:"one"},busy=false,editorComposing=false;',context);
vm.runInContext(autoLinkScript,context);
function textNode(data){return {nodeType:3,data,get textContent(){return this.data}}}
function anchor(href,text){return {nodeType:1,tagName:'A',childNodes:[textNode(text)],textContent:text,getAttribute:()=>href,setAttribute(name,value){if(name==='href')href=value}}}
function block(text, options={}) {
  const children=[];for(const [index,line] of text.split('\n').entries()){if(index)children.push({nodeType:1,tagName:'BR',childNodes:[]});children.push(textNode(line))}
  const links=options.href?[{nodeType:1,tagName:'A',childNodes:children,get textContent(){return text},getAttribute:()=>options.href}]:[];
  const node={nodeType:1,tagName:'P',childNodes:links.length?links:children,attached:true,textContent:text,outerHTML:`<p>${text.replaceAll('\n','<br>')}</p>`,matches:()=>!options.notParagraph,closest:()=>options.excluded?{}:null,querySelector:()=>options.child?{}:null,querySelectorAll:()=>links};
  for(const child of children)child.parentElement=links[0]||node;for(const link of links)link.parentElement=node;
  return node;
}
function candidate(node){context.node=node;return vm.runInContext('autoCardCandidate(node)',context)}
assert.equal(candidate(block(' https://example.test/path ')),'https://example.test/path');
assert.equal(candidate(block('www.example.test')),'https://www.example.test');
assert.equal(candidate(block('https://example.test/path',{href:'https://example.test/path'})),'https://example.test/path');
for(const node of [block('see https://example.test'),block('https://example.test https://other.test'),block('https://example.test.'),block('javascript:alert(1)'),block('https://user:pass@example.test'),block('https://example.test',{excluded:true}),block('https://example.test',{child:true}),block('https://example.test',{notParagraph:true}),block('https://example.test',{href:'https://different.test'})])assert.equal(candidate(node),null);

// Production 607 reproducer: the second URL is on its own BR line in a
// paragraph that also contains prose. Its anchor and prose must stay in place.
const mixed=block('당근 거래로 업어온 MTB 한대를 차에 업고 올라옵니다 ㅎㅎ\n\nhttps://dwnc.me/posts/606');
assert.equal(candidate(mixed),'https://dwnc.me/posts/606');
const double=block('본문\nhttps://dwnc.me/posts/604\nhttps://dwnc.me/posts/606');
context.node=double;assert.deepEqual(Array.from(vm.runInContext('autoCardCandidates(node)',context),item=>item.href),['https://dwnc.me/posts/604','https://dwnc.me/posts/606']);
assert.equal(candidate(block('본문 https://dwnc.me/posts/606')),null,'An inline prose URL is not a preview line');
assert.equal(candidate(block('https://exa\nmple.test')),null,'A BR inside a URL is not an address');
assert.equal(candidate(block('본문\nhttps://dwnc.me/posts/606',{href:'https://dwnc.me/posts/604'})),null,'Displayed URL and overlapping anchor must agree');

// An API reply must not overwrite any edit made while metadata was loading.
for(const mode of ['changed','detached','switched','busy','composition','failed']){
  const node=block('https://example.test');context.node=node;context.api=async()=>{if(mode==='failed')throw new Error('offline');if(mode==='changed')node.outerHTML='<p>user edit</p>';if(mode==='detached')node.attached=false;if(mode==='switched')vm.runInContext('current={id:"two"}',context);if(mode==='busy')vm.runInContext('busy=true',context);if(mode==='composition')vm.runInContext('editorComposing=true',context);return{html:'<figure data-ke-type="opengraph"></figure>'}};
  context.document={createElement(){throw new Error('stale response reached DOM mutation')}};
  // Catching errors inside resolve is intentional, so separately count access.
  let touched=false;context.document={createElement(){touched=true;throw new Error('unexpected')}};
  vm.runInContext('current={id:"one"};busy=false;editorComposing=false',context);
  await vm.runInContext('autoCardResolve(node,"https://example.test",{postId:"one",html:node.outerHTML})',context);
  assert.equal(touched,false,mode);
}
// Pasted blocks qualify independently from whole-document plain-text equality.
const old=block('https://old.test'),pasted=block('https://new.test');
root.querySelectorAll=()=>[old,pasted];context.beforeBlocks=new Map([[old,old.outerHTML]]);context.old=old;context.pasted=pasted;
vm.runInContext('autoCardMarkPaste(beforeBlocks)',context);
assert.equal(vm.runInContext('autoCardEligible.has(old)',context),false);
assert.equal(vm.runInContext('autoCardEligible.get(pasted).has("https://new.test")',context),true);
root.querySelectorAll=()=>[];
// Real-browser regression: editing the suffix can leave it outside its anchor.
let linkHref='https://dwnc.me/posts/1';
const prefix=textNode('https://dwnc.me/posts/'),suffix=textNode('2');
const partialLink={nodeType:1,tagName:'A',getAttribute:()=>linkHref,textContent:prefix.textContent,childNodes:[prefix],setAttribute(name,value){if(name==='href')linkHref=value},replaceWith(...nodes){edited.childNodes=[...nodes,suffix]},append(...nodes){this.childNodes=nodes;this.textContent=nodes.map(node=>node.textContent).join('')}};
const edited={nodeType:1,tagName:'P',textContent:'https://dwnc.me/posts/2',childNodes:[partialLink,suffix],querySelectorAll:()=>[partialLink],querySelector:()=>null,closest:()=>null,append(node){this.childNodes=[node]}};
context.edited=edited;vm.runInContext('autoCardRefreshEditedLink(edited)',context);
assert.equal(linkHref,'https://dwnc.me/posts/2');
assert.equal(edited.childNodes.length,1);assert.equal(partialLink.textContent,edited.textContent);
assert.deepEqual(partialLink.childNodes,[prefix,suffix],'Retyping preserves the existing inline nodes');
// URL remains in place, preview is adjacent, and repeats cannot duplicate it.
const urlBlock=block('https://example.test');let inserted=null,scheduled=0;
urlBlock.hasAttribute=()=>false;urlBlock.contains=()=>false;urlBlock.after=card=>{inserted=card;urlBlock.nextElementSibling=card};
const card={matches:()=>true,getAttribute:()=>null,querySelector:()=>({getAttribute:()=> 'https://example.test'})};
context.node=urlBlock;context.api=async()=>({html:'<figure data-ke-type="opengraph"></figure>'});
context.document={createElement:()=>({content:{firstElementChild:card,childElementCount:1}})};
context.bodyRange=()=>null;context.commitEditorHistory=()=>{};context.captureEditorBefore=()=>{};context.schedule=()=>scheduled++;
vm.runInContext('current={id:"one"};busy=false;editorComposing=false;let editorTyping=null;',context);
await vm.runInContext('autoCardResolve(node,"https://example.test",{postId:"one",html:node.outerHTML})',context);
assert.equal(inserted,card);assert.equal(urlBlock.textContent,'https://example.test');assert.equal(scheduled,1);
assert.equal(vm.runInContext('autoCardHasPreview(node,"https://example.test")',context),true);
assert.equal(vm.runInContext('autoCardHasPreview(node,"https://other.test")',context),false);
// Metadata arriving in reverse order must still append cards in URL order,
// without rebuilding the prose/BR/anchor paragraph or disturbing the caret.
const ordered=block('본문\nhttps://dwnc.me/posts/604\nhttps://dwnc.me/posts/606');
ordered.hasAttribute=()=>false;const siblings=[ordered];
function wireSibling(item){Object.defineProperty(item,'nextElementSibling',{configurable:true,get:()=>siblings[siblings.indexOf(item)+1]});item.after=next=>{const oldIndex=siblings.indexOf(next);if(oldIndex>=0)siblings.splice(oldIndex,1);siblings.splice(siblings.indexOf(item)+1,0,next);wireSibling(next)}}
function preview(href){return {attached:true,matches:selector=>selector==='figure[data-ke-type="opengraph"]',getAttribute:name=>name==='data-og-url'?href:null,querySelector:()=>null,remove(){siblings.splice(siblings.indexOf(this),1);this.attached=false}}}
wireSibling(ordered);const waiters=new Map();context.api=async(path,options)=>{const href=JSON.parse(options.body).url;return await new Promise(resolve=>waiters.set(href,resolve))};
context.document={activeElement:root,createElement(){return {content:null,set innerHTML(html){this.content={firstElementChild:preview(html),childElementCount:1}}}}};
const caretNode=ordered.childNodes.at(-1),savedRange={collapsed:true,startContainer:caretNode,endContainer:caretNode,cloneRange(){return this}};let restoredRange=null;
ordered.contains=node=>node===caretNode;context.bodyRange=()=>savedRange;context.window={getSelection:()=>({removeAllRanges(){},addRange(range){restoredRange=range}})};context.captureFormatRange=()=>{};
context.node=ordered;vm.runInContext('current={id:"one"};busy=false;editorComposing=false',context);
const originalHtml=ordered.outerHTML,first=vm.runInContext('autoCardResolve(node,"https://dwnc.me/posts/604",{postId:"one",html:node.outerHTML})',context),second=vm.runInContext('autoCardResolve(node,"https://dwnc.me/posts/606",{postId:"one",html:node.outerHTML})',context);
waiters.get('https://dwnc.me/posts/606')({html:'https://dwnc.me/posts/606'});await second;
waiters.get('https://dwnc.me/posts/604')({html:'https://dwnc.me/posts/604'});await first;
assert.deepEqual(siblings.slice(1).map(card=>card.getAttribute('data-og-url')),['https://dwnc.me/posts/604','https://dwnc.me/posts/606']);
assert.equal(ordered.outerHTML,originalHtml);assert.equal(restoredRange,savedRange);
// Native Enter creates a blank typing P before the existing preview group.
// Its live caret remains in P while the known cards stay beside their source.
context.node=ordered;const knownCards=siblings.slice(1);context.previous=vm.runInContext('autoCardPreviousPreview(node)',context);
const gap=block('');gap.matches=selector=>selector==='p,div';wireSibling(gap);siblings.splice(1,0,gap);
const gapRange={collapsed:true,startContainer:gap,endContainer:gap,startOffset:0,endOffset:0,cloneRange(){return this}};context.bodyRange=()=>gapRange;restoredRange=null;
vm.runInContext('autoCardKeepAdjacent(previous)',context);
assert.deepEqual(siblings,[ordered,...knownCards,gap]);assert.equal(restoredRange,gapRange);assert.equal(gap.textContent,'');assert.equal(ordered.outerHTML,originalHtml);
assert.equal(vm.runInContext('autoCardHasPreview(node,"https://dwnc.me/posts/604")&&autoCardHasPreview(node,"https://dwnc.me/posts/606")',context),true,'Enter must not hide old cards from duplicate detection');
// Card repair never crosses another prose paragraph or non-text content.
for(const obstruction of [block('다음 본문'),block('',{child:true})]){obstruction.matches=selector=>selector==='p,div';siblings.splice(0,siblings.length,ordered,obstruction,...knownCards);wireSibling(obstruction);vm.runInContext('autoCardKeepAdjacent(previous)',context);assert.deepEqual(siblings,[ordered,obstruction,...knownCards])}
siblings.splice(0,siblings.length,ordered,...knownCards);context.bodyRange=()=>savedRange;

const beforeRepeat=scheduled;context.api=async()=>({html:'https://dwnc.me/posts/606'});await vm.runInContext('autoCardResolve(node,"https://dwnc.me/posts/606",{postId:"one",html:node.outerHTML})',context);assert.equal(scheduled,beforeRepeat,'Existing adjacent cards do not duplicate');
context.bodyRange=()=>({...savedRange,collapsed:false});context.api=async()=>({html:'https://dwnc.me/posts/608'});context.node=block('https://dwnc.me/posts/608');context.node.contains=()=>true;context.node.hasAttribute=()=>false;
await vm.runInContext('autoCardResolve(node,"https://dwnc.me/posts/608",{postId:"one",html:node.outerHTML})',context);assert.equal(scheduled,beforeRepeat,'A selection inside the URL blocks insertion');

// Editing a URL suffix leaves its old href temporarily behind. Removing that
// URL's stale card keeps the replacement eligible, without touching its peer.
context.node=ordered;context.bodyRange=()=>null;const oldLink=anchor('https://dwnc.me/posts/604','https://dwnc.me/posts/604'),peerLink=anchor('https://dwnc.me/posts/606','https://dwnc.me/posts/606');
ordered.childNodes=[textNode('본문'),{nodeType:1,tagName:'BR',childNodes:[]},oldLink,{nodeType:1,tagName:'BR',childNodes:[]},peerLink];ordered.querySelectorAll=()=>[oldLink,peerLink];context.previous=vm.runInContext('autoCardPreviousPreview(node)',context);
oldLink.childNodes[0].data=oldLink.textContent='https://dwnc.me/posts/607';ordered.textContent='본문\nhttps://dwnc.me/posts/607\nhttps://dwnc.me/posts/606';
vm.runInContext('autoCardRemoveStale(previous)',context);assert.equal(siblings.length,2);assert.equal(siblings[1].getAttribute('data-og-url'),'https://dwnc.me/posts/606');
assert.equal(vm.runInContext('autoCardEligible.get(node).has("https://dwnc.me/posts/607")',context),true);
assert.equal(vm.runInContext('autoCardEligible.get(node).has("https://dwnc.me/posts/606")',context),false);
vm.runInContext('autoCardRefreshEditedLink(node)',context);assert.equal(oldLink.getAttribute('href'),'https://dwnc.me/posts/607');
assert.deepEqual(Array.from(vm.runInContext('autoCardCandidates(node)',context),item=>item.href),['https://dwnc.me/posts/607','https://dwnc.me/posts/606']);

// Pasting a new line into an existing paragraph qualifies only that new URL.
const pastedMixed=block('본문\nhttps://old.test\nhttps://new.test');root.querySelectorAll=()=>[pastedMixed];context.beforeBlocks=new Map([[pastedMixed,'<p>본문<br>https://old.test</p>']]);context.old=pastedMixed;
context.document={createElement(){return {content:null,set innerHTML(html){this.content={firstElementChild:block(html.replace(/^<p>|<\/p>$/g,'').replaceAll('<br>','\n')),childElementCount:1}}}}};
vm.runInContext('resetAutoLinks();autoCardMarkPaste(beforeBlocks)',context);assert.equal(vm.runInContext('autoCardEligible.get(old).has("https://old.test")',context),false);assert.equal(vm.runInContext('autoCardEligible.get(old).has("https://new.test")',context),true);root.querySelectorAll=()=>[];

console.log('PASS editor automatic cards: URL-line eligibility, anchor identity, exclusions, stale edits/navigation/composition/offline preservation');
// Independent URLs in one BR paragraph queue separately. An untouched URL
// beside a newly pasted URL must not borrow the new URL's provenance.
root.childNodes=[double];root.querySelectorAll=()=>[double];context.node=double;
vm.runInContext('resetAutoLinks();autoCardMark(node,"https://dwnc.me/posts/606");autoCardActive=3;autoCardQueue()',context);
assert.deepEqual(Array.from(vm.runInContext('autoCardJobs',context),job=>job[1]),['https://dwnc.me/posts/606']);
vm.runInContext('autoCardMark(node,"https://dwnc.me/posts/604");autoCardQueue();autoCardQueue()',context);
assert.deepEqual(Array.from(vm.runInContext('autoCardJobs',context),job=>job[1]),['https://dwnc.me/posts/606','https://dwnc.me/posts/604']);
assert.equal(double.textContent,'본문\nhttps://dwnc.me/posts/604\nhttps://dwnc.me/posts/606');
vm.runInContext('autoCardJobs.length=0;autoCardActive=0',context);root.childNodes=[];root.querySelectorAll=()=>[];

// A raw root URL is wrapped in P for its card. Keep the live Range outside
// that moved URL (after Shift+Enter's BR), rather than remapping an offset that
// now also includes the new P's synthetic newline.
const looseUrl=textNode('https://dwnc.me/posts/597'),prose=textNode('Keep this text'),breakNode=()=>({nodeType:1,tagName:'BR',childNodes:[],matches:()=>false});
root.childNodes=[prose,breakNode(),breakNode(),looseUrl,breakNode(),breakNode()];root.querySelectorAll=()=>[];for(const child of root.childNodes)child.parentNode=root;
looseUrl.before=node=>{root.childNodes.splice(root.childNodes.indexOf(looseUrl),0,node);node.parentNode=root};
const brRange={startContainer:root,startOffset:5,endContainer:root,endOffset:5,collapsed:true,cloneRange(){return this}};
context.bodyRange=()=>brRange;context.window={getSelection:()=>({removeAllRanges(){},addRange(range){restoredRange=range}})};restoredRange=null;
context.document={createElement(tag){assert.equal(tag,'p');return {nodeType:1,tagName:'P',childNodes:[],append(node){node.parentNode.childNodes.splice(node.parentNode.childNodes.indexOf(node),1);this.childNodes.push(node);node.parentNode=this}}}};
context.looseUrl=looseUrl;vm.runInContext('autoCardLooseNode=looseUrl;autoCardWrapLoose()',context);
assert.equal(restoredRange,brRange,'A live BR boundary must not fall back into the wrapped URL');assert.equal(root.childNodes[3].tagName,'P');assert.equal(root.childNodes[4].tagName,'BR');assert.equal(root.childNodes[3].childNodes[0].data,'https://dwnc.me/posts/597');
// Selection within the moved URL still uses the existing offset restoration.
root.childNodes=[looseUrl];looseUrl.parentNode=root;context.bodyRange=()=>({startContainer:looseUrl,startOffset:looseUrl.data.length,endContainer:looseUrl,endOffset:looseUrl.data.length,collapsed:true,cloneRange(){return this}});
let movedOffsets=null;context.restoreMoved=(snapshot,start,end)=>{movedOffsets=[start,end]};vm.runInContext('let originalRestore=autoLinkRestore;autoLinkRestore=restoreMoved;autoCardLooseNode=looseUrl;autoCardWrapLoose();autoLinkRestore=originalRestore',context);
assert.deepEqual(movedOffsets,[looseUrl.data.length,looseUrl.data.length]);root.childNodes=[];context.bodyRange=()=>null;

// Large pastes must not create an unbounded metadata request burst.
let active=0,peak=0;const releases=[];
context.resolveJob=async()=>{active++;peak=Math.max(peak,active);await new Promise(resolve=>releases.push(resolve));active--};
vm.runInContext('autoCardResolve=resolveJob;for(let i=0;i<10;i++)autoCardJobs.push([null,null,null]);autoCardDrain()',context);
assert.equal(active,3);
while(releases.length){releases.shift()();await new Promise(resolve=>setImmediate(resolve))}
assert.equal(peak,3);assert.equal(active,0);
