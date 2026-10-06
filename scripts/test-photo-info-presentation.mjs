import assert from 'node:assert/strict';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

// Wrangler keeps function names when it bundles the Worker. Serialize the
// bundled function, then execute it without any Worker-local helper globals.
const bundled = await build({
  entryPoints: [fileURLToPath(new URL('../src/lib/photo-info-presentation.ts', import.meta.url))],
  bundle: true,
  keepNames: true,
  format: 'cjs',
  platform: 'node',
  write: false,
  logLevel: 'silent',
});
const worker = vm.createContext({ module: { exports: {} } });
vm.runInContext(bundled.outputFiles[0].text, worker, { timeout: 1000 });
const serialized = worker.module.exports.photoHdrRows.toString();
const serializedColor = worker.module.exports.photoColorRows.toString();

function browserRows(info) {
  const browser = vm.createContext({ info });
  assert.equal(browser.__name, undefined);
  const rows = vm.runInContext('(' + serialized + ')(info)', browser, { timeout: 1000 });
  return JSON.parse(JSON.stringify(rows));
}
function browserColors(info) {
  const browser = vm.createContext({ info });
  assert.equal(browser.__name, undefined);
  const lines = vm.runInContext('(' + serializedColor + ')(info)', browser, { timeout: 1000 });
  return JSON.parse(JSON.stringify(lines));
}

assert.deepEqual(browserColors(), [['색영역','미확인']]);
assert.deepEqual(browserColors(null), [['색영역','미확인']]);
assert.deepEqual(browserColors({colorSpace:'sRGB',profileName:'sRGB',colorProfileFormat:'EXIF'}), [['색영역','sRGB'],['색상 저장','EXIF 색공간 태그']]);
assert.deepEqual(browserColors({colorSpace:'Display P3',profileName:'Display P3',colorProfileFormat:'ICC'}), [['색영역','Display P3'],['색상 저장','ICC 프로필','Display P3']]);
assert.deepEqual(browserColors({colorSpace:'Display P3',profileName:'sRGB EOTF with DCI-P3 Color Gamut',colorProfileFormat:'ICC'}), [['색영역','Display P3'],['색상 저장','ICC 프로필','sRGB EOTF with DCI-P3 Color Gamut']], 'The identified P3 transform and ICC storage are visible without a duplicate profile description');
assert.deepEqual(browserColors({colorSpace:null,profileName:'sRGB EOTF with DCI-P3 Color Gamut',colorProfileFormat:'ICC'}), [['색영역','미확인'],['색상 저장','ICC 프로필','sRGB EOTF with DCI-P3 Color Gamut'],['색상 프로필','sRGB EOTF with DCI-P3 Color Gamut']], 'A profile name alone never identifies Display P3');
assert.deepEqual(browserColors({colorSpace:'Display P3',profileName:'Custom camera RGB profile',colorProfileFormat:'ICC'}), [['색영역','Display P3'],['색상 저장','ICC 프로필','Custom camera RGB profile'],['색상 프로필','Custom camera RGB profile']], 'Nonduplicate custom profiles remain visible');
assert.deepEqual(browserColors({colorSpace:null,profileName:'sRGB'}), [['색영역','미확인'],['색상 프로필','sRGB']]);
assert.deepEqual(browserColors({colorSpace:'Custom RGB',profileName:null}), [['색영역','Custom RGB']]);
assert.deepEqual(browserRows(), [['HDR 규격','미확인']]);
assert.deepEqual(browserRows(null), [['HDR 규격','미확인']]);
assert.deepEqual(browserRows({hdr:'not-indicated'}), [['HDR 규격','확인된 기록 없음']], 'No read declaration cannot infer an SDR base or display support');
assert.deepEqual(browserRows({hdr:'metadata-present'}), [['HDR 규격','미확인']], 'A flag cannot supply unread formats or numbers');
const unconfirmed=['게인맵 영상','미확인','HDR 규격 표시는 있으나 보조 영상은 확인하지 못했습니다.'];
assert.deepEqual(browserRows({hdr:'metadata-present',hdrDetails:{formats:['Apple HDR 게인맵'],versions:['Apple 65536']}}), [['HDR 규격','Apple','파일에 기록된 버전: Apple 65536'],unconfirmed]);
assert.deepEqual(browserRows({hdrDetails:{formats:['Adobe HDR 게인맵','ISO 21496-1 게인맵','Adobe HDR 게인맵'],versions:['Adobe 1.0','ISO 작성 0 · 최소 0']}}), [['HDR 규격','Adobe XMP 1.0 · ISO 21496-1','파일에 기록된 버전: Adobe 1.0 · ISO 작성 0 · 최소 0'],unconfirmed]);
assert.deepEqual(browserRows({hdrDetails:{formats:['Custom HDR','Custom HDR']}}), [['HDR 규격','Custom HDR']]);
const imageNote='보조 JPEG의 헤더와 끝표지를 확인했습니다. 영상 디코딩이나 원본과의 동일성 검사는 아닙니다.';
const recorded={hdrDetails:{formats:['Adobe HDR 게인맵','ISO 21496-1 게인맵'],versions:['Adobe 1.0','ISO 작성 0 · 최소 0'],gainMapImage:{format:'JPEG',width:964,height:1280,channels:1}}};
assert.deepEqual(browserRows(recorded), [['HDR 규격','Adobe XMP 1.0 · ISO 21496-1','파일에 기록된 버전: Adobe 1.0 · ISO 작성 0 · 최소 0'],['게인맵','JPEG · 964 × 1280 · 흑백',imageNote]], 'The exact auxiliary format/dimensions/channel count are visible without inventing brightness values');
assert.equal(browserRows({...recorded,hdrDetails:{...recorded.hdrDetails,gainMapImage:{format:'JPEG',width:10,height:20,channels:3}}})[1][1],'JPEG · 10 × 20 · RGB');
assert.deepEqual(browserRows({hdrDetails:{formats:['Adobe HDR 게인맵'],gainMapImage:{format:'JPEG',width:0,height:20,channels:1}}})[1],unconfirmed,'Invalid auxiliary dimensions cannot claim a confirmed image');
const scalar=browserRows({hdrDetails:{formats:['Adobe HDR 게인맵'],parameterSource:'adobe',gainMapMin:[0],gainMapMax:[3],hdrCapacityMin:0,hdrCapacityMax:4,baseRenditionIsHDR:false}});
assert.equal(scalar.find(row=>row[0]==='밝기 보정값')[1],'1~8배 (0~3스톱)');assert.match(scalar.find(row=>row[0]==='밝기 보정값')[2],/실제 화면 밝기.*아닙니다.*Adobe XMP/);
assert.equal(scalar.find(row=>row[0]==='HDR 적용 시작 기준')[1],'화면 밝기 여유 1배 (0스톱)');assert.equal(scalar.find(row=>row[0]==='HDR 전체 적용 기준')[1],'화면 밝기 여유 16배 (4스톱)');assert.equal(scalar.find(row=>row[0]==='기본 사진')[1],'SDR');
const mixed=browserRows({hdrDetails:{formats:['ISO 21496-1 게인맵'],parameterSource:'iso',gainMapMin:[-1,0,1],gainMapMax:[2],baseRenditionIsHDR:true}});assert.equal(mixed.find(row=>row[0]==='밝기 보정값')[1],'R 0.5~4배 (-1~2스톱) · G 1~4배 (0~2스톱) · B 2~4배 (1~2스톱)');assert.equal(mixed.find(row=>row[0]==='기본 사진')[1],'HDR');
const partial=browserRows({hdrDetails:{formats:['Adobe HDR 게인맵'],gainMapMax:[3],hdrCapacityMax:4}});assert.equal(partial.find(row=>row[0]==='밝기 보정 최대값')[1],'8배 (3스톱)');assert.equal(partial.some(row=>row[0]==='밝기 보정값'||row[0]==='HDR 적용 시작 기준'),false,'Missing minimum values remain missing');
assert.equal(browserRows({hdrDetails:{formats:['Apple HDR 게인맵'],appleHeadroom:4.5}}).find(row=>row[0]==='HDR 밝기 여유')[1],'4.5배','Apple headroom is already a linear ratio, never exponentiated');
assert.ok(browserRows({hdrDetails:{formats:['Adobe HDR 게인맵'],gainMapMin:[-2000],gainMapMax:[2000]}}).find(row=>row[0]==='밝기 보정값')[1].includes('스톱'));assert.equal(browserRows({hdrDetails:{formats:['Adobe HDR 게인맵'],gainMapMin:[NaN],gainMapMax:[Infinity]}}).some(row=>row[0].includes('보정')),false);
// The shared idle preloader must also survive Worker keepNames serialization.
const preloadBundle=await build({entryPoints:[fileURLToPath(new URL('../src/lib/photo-info-preload.ts',import.meta.url))],bundle:true,keepNames:true,format:'cjs',platform:'node',write:false,logLevel:'silent'});
const preloadWorker=vm.createContext({module:{exports:{}}});vm.runInContext(preloadBundle.outputFiles[0].text,preloadWorker);
const idle=[],pending=[];let eligible=['a','a','b','c'];const preloadBrowser=vm.createContext({window:{requestIdleCallback:callback=>idle.push(callback)},paths:()=>eligible,read:path=>new Promise((resolve,reject)=>pending.push({path,resolve,reject}))});
vm.runInContext('preloader=('+preloadWorker.module.exports.createPhotoInfoPreloader.toString()+')(paths,read)',preloadBrowser);assert.equal(preloadBrowser.__name,undefined);preloadBrowser.preloader.schedule();preloadBrowser.preloader.schedule();assert.equal(idle.length,1);idle.shift()();assert.deepEqual(pending.map(item=>item.path),['a','b'],'Duplicate paths are coalesced and concurrency is two');pending[0].reject(new Error('unavailable'));await new Promise(resolve=>setImmediate(resolve));idle.shift()();assert.deepEqual(pending.map(item=>item.path),['a','b','c']);pending[1].resolve({});pending[2].resolve({});await new Promise(resolve=>setImmediate(resolve));idle.shift()();assert.equal(pending.length,3,'Speculative failures do not repeatedly retry');
eligible=[];preloadBrowser.preloader.reset();idle.shift()();assert.equal(pending.length,3,'Responsive/source checks are evaluated when the idle callback runs');eligible=['next'];preloadBrowser.preloader.schedule();idle.shift()();assert.equal(pending.at(-1).path,'next');pending.at(-1).resolve({});await new Promise(resolve=>setImmediate(resolve));idle.shift()();
console.log(JSON.stringify({suite:'photo-info-presentation',status:'PASS',behavior:'keepNames functions serialize independently, exact color/ICC/EXIF and HDR XMP/ISO formats, auxiliary JPEG and channel identity, declaration-only fallback, no guessed values and distinct coefficient/display ratios'}));
