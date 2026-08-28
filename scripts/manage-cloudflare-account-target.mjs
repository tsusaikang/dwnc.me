import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assertCloudflareAccountTargetOutsideRepository,
  cloudflareAccountTargetRecoveryMetadataPath,
  defaultCloudflareAccountTargetMetadataPath,
  initializeCloudflareAccountTarget,
  preflightCloudflareAccountTargetInitialization,
  recoverCloudflareAccountTargetMetadata,
  verifyCloudflareAccountTarget,
} from './lib/cloudflare-account-target.mjs';
import { installStructuredErrorHandler } from './lib/cloudflare-process.mjs';
import { loadTrackedPublicMediaReleasePolicy } from './lib/public-media-manifest.mjs';

export async function manageCloudflareAccountTarget({
  argv = process.argv.slice(2),
  root = process.cwd(),
  metadataPath,
  loadPolicy = loadTrackedPublicMediaReleasePolicy,
  preflight = preflightCloudflareAccountTargetInitialization,
  initialize = initializeCloudflareAccountTarget,
  recover = recoverCloudflareAccountTargetMetadata,
  verify = verifyCloudflareAccountTarget,
} = {}) {
  if (!Array.isArray(argv) || argv.length !== 1
    || !['--mode=preflight', '--mode=initialize', '--mode=recover', '--mode=inspect']
      .includes(argv[0])
    || typeof root !== 'string' || !path.isAbsolute(root) || path.resolve(root) !== root
    || metadataPath !== undefined && (typeof metadataPath !== 'string'
      || !path.isAbsolute(metadataPath) || path.resolve(metadataPath) !== metadataPath)) {
    throw new Error('CLOUDFLARE_E_ACCOUNT_STORE_ARGUMENT');
  }
  const selectedMetadataPath = metadataPath ?? defaultCloudflareAccountTargetMetadataPath();
  const selectedRecoveryMetadataPath = cloudflareAccountTargetRecoveryMetadataPath(
    selectedMetadataPath,
  );
  await assertCloudflareAccountTargetOutsideRepository(selectedMetadataPath, root);
  await assertCloudflareAccountTargetOutsideRepository(selectedRecoveryMetadataPath, root);
  const policy = await loadPolicy(root);
  const expectedAccountIdSha256 = policy?.staging?.accountIdSha256;
  if (policy?.staging?.environment !== 'staging'
    || policy?.staging?.bucket !== 'dwnc-me-public-media-staging'
    || !/^[a-f0-9]{64}$/u.test(expectedAccountIdSha256 ?? '')) {
    throw new Error('CLOUDFLARE_E_ACCOUNT_STORE_TARGET');
  }
  const mode = argv[0].slice('--mode='.length);
  let result;
  if (mode === 'preflight') {
    result = await preflight({
      metadataOutput: selectedMetadataPath,
      recoveryMetadataOutput: selectedRecoveryMetadataPath,
      expectedAccountIdSha256,
    });
  } else if (mode === 'initialize') {
    result = await initialize({
      metadataOutput: selectedMetadataPath,
      recoveryMetadataOutput: selectedRecoveryMetadataPath,
      expectedAccountIdSha256,
    });
  } else if (mode === 'recover') {
    result = await recover({
      metadataOutput: selectedMetadataPath,
      recoveryMetadataOutput: selectedRecoveryMetadataPath,
      expectedAccountIdSha256,
    });
  } else {
    result = await verify({
      metadataPath: selectedMetadataPath,
      recoveryMetadataPath: selectedRecoveryMetadataPath,
      expectedAccountIdSha256,
    });
  }
  const summaries = {
    preflight: result.state === 'ready'
      ? '저장 위치와 Mac 보관함을 확인했습니다. 계정 번호를 안전하게 저장할 준비가 됐습니다.'
      : result.state === 'complete'
        ? '이미 저장된 계정 번호와 확인 기록이 이 프로젝트와 일치합니다.'
        : '계정 번호는 이미 안전하게 저장돼 있습니다. 확인 기록만 복구하면 됩니다.',
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
    ...(mode === 'preflight' ? {
      state: result.state,
      primaryState: result.primaryState,
      recoveryState: result.recoveryState,
      keychainState: result.keychainState,
      clipboardRead: result.clipboardRead,
      clipboardCleared: result.clipboardCleared,
      readyForInitialize: result.readyForInitialize,
    } : {}),
    accountNumberPrinted: false,
    uploadKeyRead: false,
  };
}

if (path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  installStructuredErrorHandler('cloudflare-account-target');
  console.log(JSON.stringify(await manageCloudflareAccountTarget(), null, 2));
}
