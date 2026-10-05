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
const serializedColor = worker.module.exports.photoColorLines.toString();

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

assert.deepEqual(browserColors(), ['색상 정보 미확인']);
assert.deepEqual(browserColors(null), ['색상 정보 미확인']);
assert.deepEqual(browserColors({colorSpace:'sRGB',profileName:'sRGB'}), ['표준 색상 범위 · sRGB']);
assert.deepEqual(browserColors({colorSpace:'Display P3',profileName:'Display P3'}), ['넓은 색상 범위 · Display P3']);
assert.deepEqual(browserColors({colorSpace:'Display P3',profileName:'sRGB EOTF with DCI-P3 Color Gamut'}), ['넓은 색상 범위 · Display P3'], 'A separately identified ICC transform makes its known description redundant');
assert.deepEqual(browserColors({colorSpace:null,profileName:'sRGB EOTF with DCI-P3 Color Gamut'}), ['색상 정보 미확인','색상 설정 · sRGB EOTF with DCI-P3 Color Gamut'], 'A profile name alone is never promoted to Display P3');
assert.deepEqual(browserColors({colorSpace:'Display P3',profileName:'Custom camera RGB profile'}), ['넓은 색상 범위 · Display P3','색상 설정 · Custom camera RGB profile'], 'Other profile names remain intact');
assert.deepEqual(browserColors({colorSpace:null,profileName:'sRGB'}), ['색상 정보 미확인','색상 설정 · sRGB'], 'A deceptive profile label cannot substitute for the transform');
assert.deepEqual(browserColors({colorSpace:'Custom RGB',profileName:null}), ['색상 범위 · Custom RGB'], 'Unclassified color spaces do not acquire a wide gamut claim');
assert.deepEqual(browserRows(), [['HDR', 'HDR 밝기 정보 미확인']]);
assert.deepEqual(browserRows(null), [['HDR', 'HDR 밝기 정보 미확인']]);
assert.deepEqual(browserRows({ hdr: 'not-indicated' }), [['HDR', 'HDR 밝기 정보 없음']], 'Missing HDR information never implies an SDR base image');
assert.deepEqual(browserRows({ hdr: 'metadata-present' }), [['HDR', 'HDR 밝기 정보 있음']], 'A metadata flag cannot supply unread numeric defaults');
assert.deepEqual(browserRows({
  hdr: 'metadata-present',
  hdrDetails: { formats: ['Apple HDR 게인맵'], versions: ['Apple 65536'] },
}), [['HDR', 'HDR 밝기 정보 · 게인맵', '밝은 부분을 재현하는 보조 정보 · 규격: Apple']], 'The Apple declaration is retained as supplementary text without its internal version code or inferred headroom');
assert.deepEqual(browserRows({
  hdr: 'metadata-present',
  hdrDetails: { formats: ['Apple HDR 게인맵'], appleHeadroom: 4.5 },
}), [['HDR', 'HDR 밝기 정보 · 게인맵', '밝은 부분을 재현하는 보조 정보 · 규격: Apple'], ['밝기 여유', '4.5배']]);
assert.deepEqual(browserRows({hdrDetails:{formats:['Apple HDR 게인맵','Adobe HDR 게인맵','ISO 21496-1 게인맵','Adobe HDR 게인맵']}}),[['HDR','HDR 밝기 정보 · 게인맵','밝은 부분을 재현하는 보조 정보 · 규격: Apple · Adobe · ISO 21496-1']], 'Known methods combine in supplementary text behind one plain-language HDR label');
assert.deepEqual(browserRows({hdrDetails:{formats:['Custom HDR','Custom HDR']}}),[['HDR','HDR 밝기 정보 있음','파일에 기록된 방식: Custom HDR']], 'Unknown declarations remain available without claiming a gain map');
assert.deepEqual(browserRows({hdrDetails:{formats:['Adobe HDR 게인맵','Custom HDR']}}),[['HDR','HDR 밝기 정보 · 게인맵','밝은 부분을 재현하는 보조 정보 · 규격: Adobe · Custom HDR']], 'Other recorded declarations are preserved alongside known gain map methods');
assert.deepEqual(browserRows({
  hdr: 'metadata-present',
  hdrDetails: {
    formats: ['Adobe HDR 게인맵'],
    gainMapMin: [0], gainMapMax: [1, 2, 3],
    hdrCapacityMin: 0, hdrCapacityMax: 3.123,
    baseRenditionIsHDR: false,
  },
}), [
  ['HDR', 'HDR 밝기 정보 · 게인맵', '밝은 부분을 재현하는 보조 정보 · 규격: Adobe'],
  ['밝기 조절 범위', 'R 0 ~ 1 · G 0 ~ 2 · B 0 ~ 3 스톱'],
  ['HDR 적용 범위', '0 ~ 3.12 스톱'],
  ['기본 사진', 'SDR (일반 밝기)'],
], 'Bundled callbacks preserve mixed scalar/RGB values, zero, and an explicitly recorded false base flag');
assert.deepEqual(browserRows({
  hdr: 'metadata-present',
  hdrDetails: { formats: ['ISO 21496-1 게인맵'], gainMapMin: [-1, 0, 1], gainMapMax: [2], baseRenditionIsHDR: true },
}), [
  ['HDR', 'HDR 밝기 정보 · 게인맵', '밝은 부분을 재현하는 보조 정보 · 규격: ISO 21496-1'],
  ['밝기 조절 범위', 'R -1 ~ 2 · G 0 ~ 2 · B 1 ~ 2 스톱'],
  ['기본 사진', 'HDR'],
]);

console.log(JSON.stringify({ suite: 'photo-info-presentation', status: 'PASS', behavior: 'both keepNames functions serialized into independent browser contexts, plain-language color/HDR lines, supplementary HDR method text, verified P3 duplicate suppression without name-based inference and preserved recorded scalar/RGB ranges' }));
