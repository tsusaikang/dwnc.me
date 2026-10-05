import type { PhotoFileInfo } from './photo-file-metadata.ts';

// Display P3 has DCI-P3 primaries, a D65 white and the sRGB transfer curve:
// https://www.w3.org/TR/css-color-4/#predefined-display-p3
// Suppress this known description only when the parser separately identified
// Display P3 from the ICC transform. A profile name alone proves no color space.
export function photoColorLines(info?: Partial<PhotoFileInfo> | null): string[] {
  const color = typeof info?.colorSpace === 'string' ? info.colorSpace.trim() : '';
  const profile = typeof info?.profileName === 'string' ? info.profileName.trim() : '';
  const lines = [color === 'Display P3' ? '넓은 색상 범위 · Display P3' : color === 'sRGB' ? '표준 색상 범위 · sRGB' : color ? '색상 범위 · ' + color : '색상 정보 미확인'];
  const sameName = color && color.toLowerCase() === profile.toLowerCase();
  const sameP3 = color === 'Display P3' && profile === 'sRGB EOTF with DCI-P3 Color Gamut';
  if (profile && !sameName && !sameP3) lines.push('색상 설정 · ' + profile);
  return lines;
}

// Kept self-contained because both browser bootstraps serialize this function.
// Only display parameters that the bounded metadata inspection actually read.
export function photoHdrRows(info?: Partial<PhotoFileInfo> | null): [string, string, string?][] {
  const details = info?.hdrDetails;
  const formats = Array.isArray(details?.formats) ? details.formats.filter(value => typeof value === 'string' && value) : [];
  const methods: string[] = [], other: string[] = [];
  for (const format of formats) {
    const method = format === 'Apple HDR 게인맵' ? 'Apple' : format === 'Adobe HDR 게인맵' ? 'Adobe' : format === 'ISO 21496-1 게인맵' ? 'ISO 21496-1' : '';
    if (method) { if (!methods.includes(method)) methods.push(method); }
    else if (!other.includes(format)) other.push(format);
  }
  const state = methods.length ? 'HDR 밝기 정보 · 게인맵'
    : other.length || info?.hdr === 'metadata-present' ? 'HDR 밝기 정보 있음'
    : info?.hdr === 'not-indicated' ? 'HDR 밝기 정보 없음' : 'HDR 밝기 정보 미확인';
  const rows: [string, string, string?][] = [['HDR', state]];
  if (methods.length) rows[0].push('밝은 부분을 재현하는 보조 정보 · 규격: ' + methods.join(' · ') + (other.length ? ' · ' + other.join(' · ') : ''));
  else if (other.length) rows[0].push('파일에 기록된 방식: ' + other.join(' · '));
  const low = details?.gainMapMin, high = details?.gainMapMax;
  if (Array.isArray(low) && Array.isArray(high) && [1, 3].includes(low.length) && [1, 3].includes(high.length) && [...low, ...high].every(value => typeof value === 'number' && Number.isFinite(value))) {
    const ranges: string[] = [];
    for (let index = 0; index < Math.max(low.length, high.length); index++) {
      const min = String(Number(low[index % low.length].toFixed(2))), max = String(Number(high[index % high.length].toFixed(2)));
      ranges.push(min === max ? min : min + ' ~ ' + max);
    }
    rows.push(['밝기 조절 범위', (ranges.every(value => value === ranges[0]) ? ranges[0] : ranges.map((value, index) => ['R', 'G', 'B'][index] + ' ' + value).join(' · ')) + ' 스톱']);
  }
  if (typeof details?.hdrCapacityMin === 'number' && Number.isFinite(details.hdrCapacityMin) && typeof details.hdrCapacityMax === 'number' && Number.isFinite(details.hdrCapacityMax)) {
    const min = String(Number(details.hdrCapacityMin.toFixed(2))), max = String(Number(details.hdrCapacityMax.toFixed(2)));
    rows.push(['HDR 적용 범위', (min === max ? min : min + ' ~ ' + max) + ' 스톱']);
  }
  if (typeof details?.appleHeadroom === 'number' && Number.isFinite(details.appleHeadroom) && details.appleHeadroom > 0) rows.push(['밝기 여유', String(Number(details.appleHeadroom.toFixed(2))) + '배']);
  if (typeof details?.baseRenditionIsHDR === 'boolean') rows.push(['기본 사진', details.baseRenditionIsHDR ? 'HDR' : 'SDR (일반 밝기)']);
  return rows;
}
