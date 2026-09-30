import mediaManifest from './data/public-media-r2-v1.json' with { type: 'json' };
import publicRequestSurface from './data/public-request-surface-v1.json' with { type: 'json' };
import edgeRedirectManifest from '../docs/EDGE_REDIRECTS_V1.json' with { type: 'json' };
import {
  createMediaWorker,
} from './lib/media-worker.ts';
import { createNativePublicWorker } from './lib/native-public-worker.ts';
import type { NativePublicEnvironment } from './lib/native-public-worker.ts';
import { handlePublicAuth } from './lib/public-auth.ts';
import type { AccessEnvironment } from './lib/access-auth.ts';

type PublicEnvironment = NativePublicEnvironment & AccessEnvironment;

const handleStatic = createMediaWorker(
  mediaManifest.entries,
  mediaManifest.manifestSha256,
  publicRequestSurface,
  edgeRedirectManifest,
);
const handle = createNativePublicWorker(handleStatic);

export default {
  async fetch(request: Request, env: PublicEnvironment, context: ExecutionContext): Promise<Response> {
    const authentication = await handlePublicAuth(request, env);
    if (authentication) return authentication;
    return handle(request, env, context);
  },
} satisfies ExportedHandler<PublicEnvironment>;
