import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assertCloudflareAccountTargetOutsideRepository,
  defaultCloudflareAccountTargetMetadataPath,
  loadCloudflareAccountTarget,
  MacOSSingleReadClipboard,
} from './lib/cloudflare-account-target.mjs';
import { installStructuredErrorHandler } from './lib/cloudflare-process.mjs';
import {
  cloudflareStagingControlTokenRecoveryMetadataPath,
  defaultCloudflareStagingControlTokenMetadataPath,
  initializeCloudflareStagingControlToken,
  loadCloudflareStagingControlToken,
  recoverCloudflareStagingControlTokenMetadata,
} from './lib/cloudflare-staging-control-token.mjs';
import { loadTrackedPublicMediaReleasePolicy } from './lib/public-media-manifest.mjs';

const FORBIDDEN_PARENT_CREDENTIALS = Object.freeze([
  'CLOUDFLARE_API_TOKEN', 'CF_API_TOKEN', 'CLOUDFLARE_API_KEY', 'CF_API_KEY',
  'CLOUDFLARE_ACCOUNT_ID', 'CF_ACCOUNT_ID', 'CLOUDFLARE_API_TOKEN_FD',
  'R2_ACCOUNT_ID', 'R2_BUCKET_NAME', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY',
  'R2_CREDENTIALS_FD',
]);

export async function manageCloudflareStagingControlToken({
  argv = process.argv.slice(2),
  environment = process.env,
  root = process.cwd(),
  accountTargetMetadataPath,
  metadataPath,
  loadPolicy = loadTrackedPublicMediaReleasePolicy,
  loadAccountTarget = loadCloudflareAccountTarget,
  initialize = initializeCloudflareStagingControlToken,
  recover = recoverCloudflareStagingControlTokenMetadata,
  load = loadCloudflareStagingControlToken,
  clipboard = new MacOSSingleReadClipboard(),
  fetchImpl = globalThis.fetch,
  now = new Date(),
} = {}) {
  if (!Array.isArray(argv) || argv.length !== 1
    || !['--mode=initialize', '--mode=recover', '--mode=inspect'].includes(argv[0])
    || typeof root !== 'string' || !path.isAbsolute(root) || path.resolve(root) !== root
    || accountTargetMetadataPath !== undefined
      && (typeof accountTargetMetadataPath !== 'string'
        || !path.isAbsolute(accountTargetMetadataPath)
        || path.resolve(accountTargetMetadataPath) !== accountTargetMetadataPath)
    || metadataPath !== undefined
      && (typeof metadataPath !== 'string' || !path.isAbsolute(metadataPath)
        || path.resolve(metadataPath) !== metadataPath)) {
    throw new Error('CLOUDFLARE_E_STAGING_CONTROL_ARGUMENT');
  }
  if (FORBIDDEN_PARENT_CREDENTIALS.some((name) => Object.hasOwn(environment, name))) {
    throw new Error('CLOUDFLARE_E_STAGING_CONTROL_PARENT_CREDENTIAL');
  }
  const selectedAccountTargetPath = accountTargetMetadataPath
    ?? defaultCloudflareAccountTargetMetadataPath();
  const selectedMetadataPath = metadataPath
    ?? defaultCloudflareStagingControlTokenMetadataPath();
  const recoveryMetadataPath
    = cloudflareStagingControlTokenRecoveryMetadataPath(selectedMetadataPath);
  await Promise.all([
    assertCloudflareAccountTargetOutsideRepository(selectedAccountTargetPath, root),
    assertCloudflareAccountTargetOutsideRepository(selectedMetadataPath, root),
    assertCloudflareAccountTargetOutsideRepository(recoveryMetadataPath, root),
  ]);
  const policy = await loadPolicy(root);
  const expectedAccountIdSha256 = policy?.staging?.accountIdSha256;
  if (policy?.staging?.environment !== 'staging'
    || policy?.staging?.bucket !== 'dwnc-me-public-media-staging'
    || typeof expectedAccountIdSha256 !== 'string') {
    throw new Error('CLOUDFLARE_E_STAGING_CONTROL_ACCOUNT');
  }
  const accountTarget = await loadAccountTarget({
    metadataPath: selectedAccountTargetPath,
    expectedAccountIdSha256,
  });
  const accountId = accountTarget?.accountId;
  const mode = argv[0].slice('--mode='.length);
  let metadata;
  if (mode === 'initialize') {
    metadata = await initialize({
      accountId,
      expectedAccountIdSha256,
      metadataOutput: selectedMetadataPath,
      clipboard,
      fetchImpl,
      now,
    });
  } else if (mode === 'recover') {
    metadata = await recover({
      accountId,
      expectedAccountIdSha256,
      metadataOutput: selectedMetadataPath,
      fetchImpl,
      now,
    });
  } else {
    const loaded = await load({
      accountId,
      expectedAccountIdSha256,
      metadataPath: selectedMetadataPath,
      now,
    });
    metadata = loaded.metadata;
    loaded.apiToken = '';
  }
  const summaries = {
    initialize: '시험용 Worker 관리 열쇠를 Mac의 안전한 보관함에 새로 저장했습니다.',
    recover: '보관된 열쇠를 바꾸지 않고 확인 기록을 복구했습니다.',
    inspect: '보관된 열쇠가 올바른 시험용 계정용이며 아직 사용할 수 있습니다.',
  };
  return {
    status: '완료',
    summary: summaries[mode],
    mode,
    environment: 'staging',
    purpose: metadata.purpose,
    accountIdSha256: metadata.accountIdSha256,
    apiTokenSha256: metadata.apiTokenSha256,
    tokenIdSha256: metadata.tokenIdSha256,
    tokenType: metadata.tokenType,
    statusAtVerification: metadata.status,
    notBefore: metadata.notBefore,
    expiresAt: metadata.expiresAt,
    permission: 'Cloudflare 계정 > Workers Scripts > Edit 한 가지',
    permissionContractSha256: metadata.permissionContractSha256,
    rawAccountPrinted: false,
    rawTokenPrinted: false,
    rawTokenIdPrinted: false,
  };
}

if (path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  installStructuredErrorHandler('cloudflare-staging-control-token');
  console.log(JSON.stringify(await manageCloudflareStagingControlToken(), null, 2));
}
