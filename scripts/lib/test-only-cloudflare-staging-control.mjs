import { syncBuiltinESMExports } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { runCloudflareStagingControl }
  from '../run-cloudflare-staging-control.mjs';

export async function runCloudflareStagingControlWithTestHome(options = {}, recoveryHome) {
  if (typeof recoveryHome !== 'string' || !path.isAbsolute(recoveryHome)
    || path.resolve(recoveryHome) !== recoveryHome) {
    throw new Error('CLOUDFLARE_E_STAGING_CONTROL_TEST_ONLY');
  }
  const nativeUserInfo = os.userInfo;
  os.userInfo = (...args) => ({ ...nativeUserInfo(...args), homedir: recoveryHome });
  syncBuiltinESMExports();
  try { return await runCloudflareStagingControl(options); }
  finally {
    os.userInfo = nativeUserInfo;
    syncBuiltinESMExports();
  }
}
