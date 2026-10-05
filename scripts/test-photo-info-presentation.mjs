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

assert.deepEqual(browserColors(), ['색공간 미확인']);
assert.deepEqual(browserColors(null), ['색공간 미확인']);
assert.deepEqual(browserColors({colorSpace:'sRGB',profileName:'sRGB'}), ['sRGB']);
assert.deepEqual(browserColors({colorSpace:'Display P3',profileName:'Display P3'}), ['Display P3']);
assert.deepEqual(browserColors({colorSpace:'Display P3',profileName:'sRGB EOTF with DCI-P3 Color Gamut'}), ['Display P3'], 'A separately identified ICC transform makes its known description redundant');
assert.deepEqual(browserColors({colorSpace:null,profileName:'sRGB EOTF with DCI-P3 Color Gamut'}), ['색공간 미확인','sRGB EOTF with DCI-P3 Color Gamut'], 'A profile name alone is never promoted to Display P3');
assert.deepEqual(browserColors({colorSpace:'Display P3',profileName:'Custom camera RGB profile'}), ['Display P3','Custom camera RGB profile'], 'Other profile names remain intact');
assert.deepEqual(browserColors({colorSpace:null,profileName:'sRGB'}), ['색공간 미확인','sRGB'], 'A deceptive profile label cannot substitute for the transform');
assert.deepEqual(browserRows(), [['HDR', 'HDR 미확인']]);
assert.deepEqual(browserRows(null), [['HDR', 'HDR 미확인']]);
assert.deepEqual(browserRows({ hdr: 'not-indicated' }), [['HDR', 'HDR 정보 없음']], 'Missing HDR information never implies an SDR base image');
assert.deepEqual(browserRows({ hdr: 'metadata-present' }), [['HDR', 'HDR 메타데이터 있음']], 'A metadata flag cannot supply unread numeric defaults');
assert.deepEqual(browserRows({
  hdr: 'metadata-present',
  hdrDetails: { formats: ['Apple HDR 게인맵'], versions: ['Apple 65536'] },
}), [['HDR', 'HDR 게인맵 (Apple)']], 'The Apple declaration displays without its internal version code or inferred headroom');
assert.deepEqual(browserRows({
  hdr: 'metadata-present',
  hdrDetails: { formats: ['Apple HDR 게인맵'], appleHeadroom: 4.5 },
}), [['HDR', 'HDR 게인맵 (Apple)'], ['밝기 여유', '4.5배']]);
assert.deepEqual(browserRows({hdrDetails:{formats:['Apple HDR 게인맵','Adobe HDR 게인맵','ISO 21496-1 게인맵','Adobe HDR 게인맵']}}),[['HDR','HDR 게인맵 (Apple · Adobe · ISO 21496-1)']], 'Known methods combine under one self-contained HDR gain-map label');
assert.deepEqual(browserRows({
  hdr: 'metadata-present',
  hdrDetails: {
    formats: ['Adobe HDR 게인맵'],
    gainMapMin: [0], gainMapMax: [1, 2, 3],
    hdrCapacityMin: 0, hdrCapacityMax: 3.123,
    baseRenditionIsHDR: false,
  },
}), [
  ['HDR', 'HDR 게인맵 (Adobe)'],
  ['게인맵', 'R 0 ~ 1 · G 0 ~ 2 · B 0 ~ 3 스톱'],
  ['HDR 여유', '0 ~ 3.12 스톱'],
  ['기준 영상', 'SDR'],
], 'Bundled callbacks preserve mixed scalar/RGB values, zero, and an explicitly recorded false base flag');
assert.deepEqual(browserRows({
  hdr: 'metadata-present',
  hdrDetails: { formats: ['ISO 21496-1 게인맵'], gainMapMin: [-1, 0, 1], gainMapMax: [2], baseRenditionIsHDR: true },
}), [
  ['HDR', 'HDR 게인맵 (ISO 21496-1)'],
  ['게인맵', 'R -1 ~ 2 · G 0 ~ 2 · B 1 ~ 2 스톱'],
  ['기준 영상', 'HDR'],
]);

console.log(JSON.stringify({ suite: 'photo-info-presentation', status: 'PASS', behavior: 'both keepNames functions serialized into independent browser contexts, self-contained color/HDR lines, verified P3 duplicate suppression without name-based inference, combined HDR methods and recorded scalar/RGB ranges' }));
