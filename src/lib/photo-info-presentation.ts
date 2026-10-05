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
  const low = details?.gainMapMin, high = details?.gainMapMax;
  if (Array.isArray(low) && Array.isArray(high) && [1, 3].includes(low.length) && [1, 3].includes(high.length) && [...low, ...high].every(value => typeof value === 'number' && Number.isFinite(value))) {
    const ranges: string[] = [];
    for (let index = 0; index < Math.max(low.length, high.length); index++) {
      const min = String(Number(low[index % low.length].toFixed(2))), max = String(Number(high[index % high.length].toFixed(2)));
      ranges.push(min === max ? min : min + ' ~ ' + max);
    }
    rows.push(['게인맵', (ranges.every(value => value === ranges[0]) ? ranges[0] : ranges.map((value, index) => ['R', 'G', 'B'][index] + ' ' + value).join(' · ')) + ' 스톱']);
  }
  if (typeof details?.hdrCapacityMin === 'number' && Number.isFinite(details.hdrCapacityMin) && typeof details.hdrCapacityMax === 'number' && Number.isFinite(details.hdrCapacityMax)) {
    const min = String(Number(details.hdrCapacityMin.toFixed(2))), max = String(Number(details.hdrCapacityMax.toFixed(2)));
    rows.push(['HDR 여유', (min === max ? min : min + ' ~ ' + max) + ' 스톱']);
  }
  if (typeof details?.appleHeadroom === 'number' && Number.isFinite(details.appleHeadroom) && details.appleHeadroom > 0) rows.push(['밝기 여유', String(Number(details.appleHeadroom.toFixed(2))) + '배']);
  if (typeof details?.baseRenditionIsHDR === 'boolean') rows.push(['기준 영상', details.baseRenditionIsHDR ? 'HDR' : 'SDR']);
  return rows;
}
