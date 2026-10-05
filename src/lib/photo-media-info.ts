import { inspectPhotoPrefix, inspectPhotoWithAuxiliary, photoAuxiliaryRange, PHOTO_METADATA_PREFIX_BYTES } from './photo-file-metadata.ts';
import type { PhotoFileInfo } from './photo-file-metadata.ts';
import { canonicalPhotoSource, publishedPhotoMetadata } from './photo-media-summary.ts';
import { boundedBody } from './content-operations.ts';
import { NATIVE_MEDIA_PATH_PATTERN, IMPORTED_MEDIA_PATH_PATTERN } from './native-content.ts';
import type { NativePostStore, NativeMedia } from './native-post-store.ts';

interface PhotoMediaEnvironment { NATIVE_MEDIA_BUCKET: R2Bucket }
interface ImportedMediaReaders {
  authorizeImported(path: string): Promise<boolean>;
  readImported(request: Request): Promise<Response>;
}
function json(value: unknown, status = 200) {
  return Response.json(value, {status, headers:{'cache-control':'no-store','x-content-type-options':'nosniff'}});
}
const missing = () => json({error:'사진 정보를 확인할 수 없습니다.'}, 404);
const unavailable = () => json({error:'사진 정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.'}, 503);
function localPath(value: unknown) {
  if (typeof value !== 'string' || value.length > 2048) return null;
  const path = canonicalPhotoSource(value);
  return path.startsWith('/media/') && !/[?#\\%\s]/u.test(path) && !path.includes('//') ? path : null;
}

type ReadRange = (offset:number, length:number) => Promise<Uint8Array | null>;
async function photoInfo(bytes: Uint8Array, size: number, mime: string, read: ReadRange): Promise<PhotoFileInfo> {
  const info = inspectPhotoPrefix(bytes, size, mime), auxiliary = photoAuxiliaryRange(bytes, size);
  if (!auxiliary) return info;
  try {
    // Include the preceding primary EOI, then at most one auxiliary prefix.
    const length = Math.min(auxiliary.length, PHOTO_METADATA_PREFIX_BYTES);
    const head = await read(auxiliary.offset - 2, length + 2);
    if (!head || head.length !== length + 2 || head[0] !== 255 || head[1] !== 217) return info;
    const end = auxiliary.length <= length ? head.subarray(head.length - 2) : await read(auxiliary.offset + auxiliary.length - 2, 2);
    return end ? inspectPhotoWithAuxiliary(bytes, size, mime, head.subarray(2), end) : info;
  } catch { return info; } // Auxiliary failures never discard primary metadata.
}

function validNativeObject(object: R2Object | null, media: NativeMedia) {
  const sha = object?.checksums?.sha256;
  const digest = sha instanceof ArrayBuffer ? [...new Uint8Array(sha)].map(byte => byte.toString(16).padStart(2,'0')).join('') : '';
  return Boolean(object && object.size === media.bytes && object.httpMetadata?.contentType?.toLowerCase() === media.mime
    && object.customMetadata?.contract === 'dwnc-native-media-v1' && object.customMetadata?.sha256 === media.sha256
    && /^[a-f0-9]{64}$/u.test(media.sha256) && digest === media.sha256);
}

async function nativeInfo(media: NativeMedia, env: PhotoMediaEnvironment) {
  if (!media.mime.startsWith('image/') || !Number.isSafeInteger(media.bytes) || media.bytes <= 0) return missing();
  const length = Math.min(media.bytes, PHOTO_METADATA_PREFIX_BYTES);
  const object = await env.NATIVE_MEDIA_BUCKET.get(media.objectKey, {range:{offset:0,length}});
  if (!object || !('body' in object) || !object.body || !validNativeObject(object, media)) { if (object && 'body' in object) await object.body?.cancel(); return missing(); }
  const bytes = await boundedBody(new Response(object.body), length);
  if (bytes.length !== length) return unavailable();
  const read: ReadRange = async (offset, rangeLength) => {
    const part = await env.NATIVE_MEDIA_BUCKET.get(media.objectKey, {range:{offset,length:rangeLength}});
    if (!part || !('body' in part) || !part.body || !validNativeObject(part, media)) { if (part && 'body' in part) await part.body?.cancel(); return null; }
    const data = await boundedBody(new Response(part.body), rangeLength);
    return data.length === rangeLength ? data : null;
  };
  return json({info:await photoInfo(bytes, media.bytes, media.mime, read)});
}

async function importedInfo(path: string, readers: ImportedMediaReaders) {
  const file = publishedPhotoMetadata(path);
  if (!file || file.bytes === null || !await readers.authorizeImported(path)) return missing();
  const length = Math.min(file.bytes, PHOTO_METADATA_PREFIX_BYTES);
  // This callback is the existing immutable-media server, including all its
  // manifest/checksum checks; this module never fetches an arbitrary URL.
  const response = await readers.readImported(new Request('https://dwnc.me' + path, {headers:{range:`bytes=0-${length - 1}`}}));
  if (![200,206].includes(response.status) || response.headers.get('content-type')?.split(';',1)[0] !== file.mime
    || Number(response.headers.get('content-length')) !== length || response.status === 200 && file.bytes > length) {
    await response.body?.cancel(); return response.status === 404 ? missing() : unavailable();
  }
  const bytes = await boundedBody(response, length);
  if (bytes.length !== length) return unavailable();
  const read: ReadRange = async (offset, rangeLength) => {
    const part = await readers.readImported(new Request('https://dwnc.me' + path, {headers:{range:`bytes=${offset}-${offset + rangeLength - 1}`}}));
    if (part.status !== 206 || part.headers.get('content-type')?.split(';',1)[0] !== file.mime
      || Number(part.headers.get('content-length')) !== rangeLength || part.headers.get('content-range') !== `bytes ${offset}-${offset + rangeLength - 1}/${file.bytes}`) {
      await part.body?.cancel(); return null;
    }
    const data = await boundedBody(part, rangeLength);
    return data.length === rangeLength ? data : null;
  };
  return json({info:await photoInfo(bytes, file.bytes, file.mime, read)});
}

export async function servePublicPhotoInfo(request: Request, env: PhotoMediaEnvironment, store: NativePostStore, readers: ImportedMediaReaders) {
  if (request.method !== 'GET') return json({error:'허용되지 않은 요청입니다.'}, 405);
  const url = new URL(request.url), path = localPath(url.searchParams.get('path'));
  if (!path || [...url.searchParams.keys()].length !== 1 || url.hash) return missing();
  try {
    if (NATIVE_MEDIA_PATH_PATTERN.test(path) || IMPORTED_MEDIA_PATH_PATTERN.test(path)) {
      // Same snapshot, schedule, password and reference checks as image delivery.
      const media = await store.getPublicMedia(path, request);
      return media ? await nativeInfo(media, env) : missing();
    }
    return await importedInfo(path, readers);
  } catch { return unavailable(); }
}

export async function serveAdminPhotoInfo(value: unknown, postId: string, env: PhotoMediaEnvironment, store: NativePostStore, readImported: ImportedMediaReaders['readImported']) {
  const path = localPath(value);
  if (!path) return missing();
  try {
    const files = await store.mediaForPost(postId);
    if (!files.some(file => file.path === path)) return missing();
    if (NATIVE_MEDIA_PATH_PATTERN.test(path) || IMPORTED_MEDIA_PATH_PATTERN.test(path)) {
      const media = await store.getAdminMedia(path);
      return media?.postId === postId ? await nativeInfo(media, env) : missing();
    }
    return await importedInfo(path, {authorizeImported:async () => true, readImported});
  } catch { return unavailable(); }
}
