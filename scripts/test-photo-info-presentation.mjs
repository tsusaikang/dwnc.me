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

function browserRows(info) {
  const browser = vm.createContext({ info });
  assert.equal(browser.__name, undefined);
  const rows = vm.runInContext('(' + serialized + ')(info)', browser, { timeout: 1000 });
  return JSON.parse(JSON.stringify(rows));
}

assert.deepEqual(browserRows(), [['HDR', '미확인']]);
assert.deepEqual(browserRows(null), [['HDR', '미확인']]);
assert.deepEqual(browserRows({ hdr: 'not-indicated' }), [['HDR', '정보 없음']], 'Missing HDR information never implies an SDR base image');
assert.deepEqual(browserRows({ hdr: 'metadata-present' }), [['HDR', '메타데이터 있음']], 'A metadata flag cannot supply unread numeric defaults');
assert.deepEqual(browserRows({
  hdr: 'metadata-present',
  hdrDetails: { formats: ['Apple HDR 게인맵'], versions: ['Apple 65536'] },
}), [['HDR', 'Apple HDR 게인맵']], 'The Apple declaration displays without its internal version code or inferred headroom');
assert.deepEqual(browserRows({
  hdr: 'metadata-present',
  hdrDetails: { formats: ['Apple HDR 게인맵'], appleHeadroom: 4.5 },
}), [['HDR', 'Apple HDR 게인맵'], ['밝기 여유', '4.5배']]);
assert.deepEqual(browserRows({
  hdr: 'metadata-present',
  hdrDetails: {
    formats: ['Adobe HDR 게인맵'],
    gainMapMin: [0], gainMapMax: [1, 2, 3],
    hdrCapacityMin: 0, hdrCapacityMax: 3.123,
    baseRenditionIsHDR: false,
  },
}), [
  ['HDR', 'Adobe HDR 게인맵'],
  ['게인맵', 'R 0 ~ 1 · G 0 ~ 2 · B 0 ~ 3 스톱'],
  ['HDR 여유', '0 ~ 3.12 스톱'],
  ['기준 영상', 'SDR'],
], 'Bundled callbacks preserve mixed scalar/RGB values, zero, and an explicitly recorded false base flag');
assert.deepEqual(browserRows({
  hdr: 'metadata-present',
  hdrDetails: { formats: ['ISO 21496-1 게인맵'], gainMapMin: [-1, 0, 1], gainMapMax: [2], baseRenditionIsHDR: true },
}), [
  ['HDR', 'ISO 21496-1 게인맵'],
  ['게인맵', 'R -1 ~ 2 · G 0 ~ 2 · B 1 ~ 2 스톱'],
  ['기준 영상', 'HDR'],
]);

console.log(JSON.stringify({ suite: 'photo-info-presentation', status: 'PASS', behavior: 'keepNames Worker bundle serialized into fresh browser contexts without helper globals, honest absent/Apple HDR data, recorded scalar/RGB zero ranges and explicit base flags' }));
