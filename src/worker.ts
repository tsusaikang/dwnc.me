import mediaManifest from './data/public-media-r2-v1.json' with { type: 'json' };
import publicRequestSurface from './data/public-request-surface-v1.json' with { type: 'json' };
import edgeRedirectManifest from '../docs/EDGE_REDIRECTS_V1.json' with { type: 'json' };
import {
  createMediaWorker,
} from './lib/media-worker.ts';
import { createNativePublicWorker } from './lib/native-public-worker.ts';
import type { NativePublicEnvironment } from './lib/native-public-worker.ts';

const handleStatic = createMediaWorker(
  mediaManifest.entries,
  mediaManifest.manifestSha256,
  publicRequestSurface,
  edgeRedirectManifest,
);
const handle = createNativePublicWorker(handleStatic);

export default {
  fetch(request: Request, env: NativePublicEnvironment, context: ExecutionContext): Promise<Response> {
    return handle(request, env, context);
  },
} satisfies ExportedHandler<NativePublicEnvironment>;
