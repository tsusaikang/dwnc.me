import mediaManifest from './data/public-media-r2-v1.json' with { type: 'json' };
import publicRequestSurface from './data/public-request-surface-v1.json' with { type: 'json' };
import {
  createMediaWorker,
} from './lib/media-worker.ts';

const handle = createMediaWorker(
  mediaManifest.entries,
  mediaManifest.manifestSha256,
  publicRequestSurface,
);

export default {
  fetch(request: Request, env: Cloudflare.ProductionEnv, context: ExecutionContext): Promise<Response> {
    return handle(request, env, context);
  },
} satisfies ExportedHandler<Cloudflare.ProductionEnv>;
