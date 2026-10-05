import type { PhotoFileInfo } from './photo-file-metadata.ts';

// Kept self-contained because both browser bootstraps serialize this function.
// Only display parameters that the bounded metadata inspection actually read.
export function photoHdrRows(info?: Partial<PhotoFileInfo> | null): [string, string][] {
  const details = info?.hdrDetails;
  const formats = Array.isArray(details?.formats) ? details.formats.filter(value => typeof value === 'string' && value) : [];
  const state = formats.length ? formats.join(' · ')
    : info?.hdr === 'metadata-present' ? '메타데이터 있음'
    : info?.hdr === 'not-indicated' ? '정보 없음' : '미확인';
  const rows: [string, string][] = [['HDR', state]];
  const number = (value: number) => String(Number(value.toFixed(2)));
  const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
  const pair = (min: number, max: number) => number(min) === number(max) ? number(min) : number(min) + ' ~ ' + number(max);
  const low = details?.gainMapMin, high = details?.gainMapMax;
  if (Array.isArray(low) && Array.isArray(high) && [1, 3].includes(low.length) && [1, 3].includes(high.length) && low.every(finite) && high.every(finite)) {
    const ranges = Array.from({length: Math.max(low.length, high.length)}, (_, index) => pair(low[index % low.length], high[index % high.length]));
    rows.push(['게인맵', (ranges.every(value => value === ranges[0]) ? ranges[0] : ranges.map((value, index) => ['R', 'G', 'B'][index] + ' ' + value).join(' · ')) + ' 스톱']);
  }
  if (finite(details?.hdrCapacityMin) && finite(details?.hdrCapacityMax)) rows.push(['HDR 여유', pair(details.hdrCapacityMin, details.hdrCapacityMax) + ' 스톱']);
  if (finite(details?.appleHeadroom) && details.appleHeadroom > 0) rows.push(['밝기 여유', number(details.appleHeadroom) + '배']);
  if (typeof details?.baseRenditionIsHDR === 'boolean') rows.push(['기준 영상', details.baseRenditionIsHDR ? 'HDR' : 'SDR']);
  return rows;
}
