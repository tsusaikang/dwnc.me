import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assertCloudflareAccountTargetOutsideRepository,
  defaultCloudflareAccountTargetMetadataPath,
  initializeCloudflareAccountTarget,
  loadCloudflareAccountTarget,
  recoverCloudflareAccountTargetMetadata,
} from './lib/cloudflare-account-target.mjs';
import { installStructuredErrorHandler } from './lib/cloudflare-process.mjs';
import { loadTrackedPublicMediaReleasePolicy } from './lib/public-media-manifest.mjs';

export async function manageCloudflareAccountTarget({
  argv = process.argv.slice(2),
  root = process.cwd(),
  metadataPath,
  loadPolicy = loadTrackedPublicMediaReleasePolicy,
  initialize = initializeCloudflareAccountTarget,
  recover = recoverCloudflareAccountTargetMetadata,
  load = loadCloudflareAccountTarget,
} = {}) {
  if (!Array.isArray(argv) || argv.length !== 1
    || !['--mode=initialize', '--mode=recover', '--mode=inspect'].includes(argv[0])
    || typeof root !== 'string' || !path.isAbsolute(root) || path.resolve(root) !== root
    || metadataPath !== undefined && (typeof metadataPath !== 'string'
      || !path.isAbsolute(metadataPath) || path.resolve(metadataPath) !== metadataPath)) {
    throw new Error('CLOUDFLARE_E_ACCOUNT_STORE_ARGUMENT');
  }
  const selectedMetadataPath = metadataPath ?? defaultCloudflareAccountTargetMetadataPath();
  await assertCloudflareAccountTargetOutsideRepository(selectedMetadataPath, root);
  const policy = await loadPolicy(root);
  const expectedAccountIdSha256 = policy?.staging?.accountIdSha256;
  if (policy?.staging?.environment !== 'staging'
    || policy?.staging?.bucket !== 'dwnc-me-public-media-staging'
    || typeof expectedAccountIdSha256 !== 'string') {
    throw new Error('CLOUDFLARE_E_ACCOUNT_STORE_TARGET');
  }
  const mode = argv[0].slice('--mode='.length);
  let result;
  if (mode === 'initialize') {
    result = await initialize({
      metadataOutput: selectedMetadataPath, expectedAccountIdSha256,
    });
  } else if (mode === 'recover') {
    result = await recover({
      metadataOutput: selectedMetadataPath, expectedAccountIdSha256,
    });
  } else {
    const loaded = await load({ metadataPath: selectedMetadataPath, expectedAccountIdSha256 });
    result = loaded.metadata;
  }
  const summaries = {
    initialize: 'Cloudflare 계정 번호를 이 Mac의 안전한 보관함에 저장했습니다.',
    recover: '이미 보관된 계정 번호를 바꾸지 않고 확인용 기록을 복구했습니다.',
    inspect: '저장된 계정 번호가 이 프로젝트에서 사용할 Cloudflare 계정과 일치합니다.',
  };
  return {
    status: '완료',
    summary: summaries[mode],
    mode,
    purpose: result.purpose,
    accountIdSha256: result.accountIdSha256,
    accountNumberPrinted: false,
    uploadKeyRead: false,
  };
}

if (path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  installStructuredErrorHandler('cloudflare-account-target');
  console.log(JSON.stringify(await manageCloudflareAccountTarget(), null, 2));
}
