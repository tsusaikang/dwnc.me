import {
  assertCloudflareAccountTarget,
  assertStagingControlOperationEnvelope,
  cloudflareControlPlaneReadCredentials,
  cloudflareStagingWranglerEnvironment,
} from './cloudflare-process.mjs';
import {
  cloudflareStagingControlPermissionContractSha256,
  cloudflareStagingControlTokenSha256,
} from './cloudflare-staging-control-token.mjs';

export function readCloudflareStagingControlOperation(source = process.env, expectedOperation, {
  readCredentials = cloudflareControlPlaneReadCredentials,
} = {}) {
  const envelope = assertStagingControlOperationEnvelope(source, expectedOperation);
  const controlPlane = readCredentials(source);
  assertCloudflareAccountTarget(controlPlane.accountId, envelope.accountIdSha256);
  if (cloudflareStagingControlTokenSha256(controlPlane.apiToken) !== envelope.apiTokenSha256
    || cloudflareStagingControlPermissionContractSha256(envelope.accountIdSha256)
      !== envelope.permissionContractSha256) {
    controlPlane.apiToken = '';
    throw new Error('CLOUDFLARE_E_STAGING_CONTROL_BINDING');
  }
  const operation = {
    accountId: controlPlane.accountId,
    apiToken: controlPlane.apiToken,
    environment: controlPlane.environment,
    envelope,
    wranglerEnvironment(extra = {}) {
      return cloudflareStagingWranglerEnvironment(source, {
        accountId: operation.accountId,
        apiToken: operation.apiToken,
      }, { expectedOperation, extra });
    },
    clear() {
      operation.apiToken = '';
      controlPlane.apiToken = '';
    },
  };
  return operation;
}
