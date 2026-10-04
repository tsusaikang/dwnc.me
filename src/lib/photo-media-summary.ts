import { load } from 'cheerio';
import mediaManifest from '../data/public-media-r2-v1.json' with { type: 'json' };

export interface PhotoFileMetadata { path: string; bytes: number | null; mime: string }
export interface PostPhotoSummary {
  count: number;
  uniqueCount: number;
  duplicateCount: number;
  unknownCount: number;
  totalBytes: number | null;
}

const cardSelector = '[data-ke-type="opengraph"],.se_component.se_oglink,.se-component.se-oglink';
const publishedFiles = new Map(mediaManifest.entries.filter(item => item.contentType.startsWith('image/'))
  .map(item => [item.publicPath, {path:item.publicPath, bytes:item.size, mime:item.contentType}]));

// Local aliases refer to the same stored file. An external site's identical
// pathname is deliberately left external, so it cannot inherit private bytes.
export function canonicalPhotoSource(value: string): string {
  const source = value.trim();
  if (!source) return '';
  if (!source.startsWith('/') && !/^https?:\/\//iu.test(source)) return source;
  try {
    const url = new URL(source, 'https://dwnc.me');
    const path = decodeURIComponent(url.pathname).normalize('NFC');
    if (['https://dwnc.me','https://admin.dwnc.me'].includes(url.origin) && !url.username && !url.password && path.startsWith('/media/')
      && !/[\\%]/u.test(path) && !path.includes('//') && (!url.search || path.startsWith('/media/native/'))) return path;
    return url.href;
  } catch { return source; }
}

export function publishedPhotoMetadata(path: string): PhotoFileMetadata | null {
  return publishedFiles.get(canonicalPhotoSource(path)) ?? null;
}

export function formatPhotoBytes(bytes: number): string {
  if (!Number.isSafeInteger(bytes) || bytes < 0) return '확인 불가';
  const units = ['B','KB','MB','GB','TB'];
  let value = bytes, unit = 0;
  while (value >= 1000 && unit < units.length - 1) { value /= 1000; unit += 1; }
  return (unit === 0 ? String(value) : value.toFixed(2).replace(/\.?0+$/u,'')) + ' ' + units[unit];
}

// The caller supplies the exact body snapshot being displayed and metadata
// owned by that post. No working copy, upload inventory or cover is inspected.
export function summarizePostPhotos(bodyHtml: string, metadata: PhotoFileMetadata[] = []): PostPhotoSummary {
  const $ = load(bodyHtml), sources: string[] = [];
  $('img[src]').each((_index, image) => {
    if ($(image).closest(cardSelector).length) return;
    const source = canonicalPhotoSource($(image).attr('src') ?? '');
    if (source) sources.push(source);
  });
  const files = new Map(metadata.map(item => [canonicalPhotoSource(item.path), item]));
  const unique = new Set(sources);
  let bytes = 0, unknownCount = 0;
  for (const source of unique) {
    const item = files.get(source) ?? publishedPhotoMetadata(source);
    if (!item?.mime.startsWith('image/') || !Number.isSafeInteger(item.bytes) || item.bytes === null || item.bytes < 1) { unknownCount += 1; continue; }
    bytes += item.bytes;
  }
  return {count:sources.length, uniqueCount:unique.size, duplicateCount:sources.length-unique.size, unknownCount, totalBytes:unknownCount || !Number.isSafeInteger(bytes) ? null : bytes};
}

export function renderPostPhotoSummary(summary: PostPhotoSummary): string {
  if (!summary.count) return '';
  const size = summary.totalBytes === null ? '총용량 확인 불가' : '총 ' + formatPhotoBytes(summary.totalBytes);
  return `<p class="post-photo-summary" aria-label="본문 사진 요약">본문 사진 ${summary.count}장 · ${size}${summary.duplicateCount ? '<small>같은 파일은 용량에 한 번만 계산</small>' : ''}</p>`;
}
