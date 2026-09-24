import assert from 'node:assert/strict';
import vm from 'node:vm';
import { autoLinkScript } from '../src/lib/admin-autolink.ts';

// Deliberately small DOM adapter: checks qualification and asynchronous stale
// response guards, not browser layout or native selection behavior.
const root={addEventListener(){},contains(node){return node.attached},querySelectorAll(){return []}};
const context=vm.createContext({URL,Map,Set,WeakMap,console,location:{origin:'https://admin.dwnc.me'},$:()=>root});
vm.runInContext('let current={id:"one"},busy=false,editorComposing=false;',context);
vm.runInContext(autoLinkScript,context);
function block(text, options={}) { return {cloneNode(){return {textContent:text,querySelectorAll(){return []}}},attached:true,textContent:text,outerHTML:`<p>${text}</p>`,matches:selector=>!options.notParagraph,closest:()=>options.excluded?{}:null,querySelector:()=>options.child?{}:null,querySelectorAll:()=>options.href?[{getAttribute:()=>options.href}]:[]}; }
function candidate(node){context.node=node;return vm.runInContext('autoCardCandidate(node)',context)}
assert.equal(candidate(block(' https://example.test/path ')),'https://example.test/path');
assert.equal(candidate(block('www.example.test')),'https://www.example.test');
assert.equal(candidate(block('https://example.test/path',{href:'https://example.test/path'})),'https://example.test/path');
for(const node of [block('see https://example.test'),block('https://example.test https://other.test'),block('https://example.test.'),block('javascript:alert(1)'),block('https://user:pass@example.test'),block('https://example.test',{excluded:true}),block('https://example.test',{child:true}),block('https://example.test',{notParagraph:true}),block('https://example.test',{href:'https://different.test'})])assert.equal(candidate(node),null);

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
console.log('PASS editor automatic cards: whole-paragraph eligibility, anchor identity, exclusions, stale edits/navigation/composition/offline preservation');
// Large pastes must not create an unbounded metadata request burst.
let active=0,peak=0;const releases=[];
context.resolveJob=async()=>{active++;peak=Math.max(peak,active);await new Promise(resolve=>releases.push(resolve));active--};
vm.runInContext('autoCardResolve=resolveJob;for(let i=0;i<10;i++)autoCardJobs.push([null,null,null]);autoCardDrain()',context);
assert.equal(active,3);
while(releases.length){releases.shift()();await new Promise(resolve=>setImmediate(resolve))}
assert.equal(peak,3);assert.equal(active,0);
