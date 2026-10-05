import type { PhotoFileInfo } from './photo-file-metadata.ts';

// Both browser bootstraps serialize these functions. Keep each self-contained.
// A profile description alone never identifies a color space. Suppress only
// the known description of a separately identified Display P3 transform.
export function photoColorRows(info?: Partial<PhotoFileInfo> | null): [string, string, string?][] {
  const color = typeof info?.colorSpace === 'string' ? info.colorSpace.trim() : '';
  const profile = typeof info?.profileName === 'string' ? info.profileName.trim() : '';
  const source = info?.colorProfileFormat;
  const rows: [string, string, string?][] = [['색영역', color || '미확인']];
  if (source === 'ICC') rows.push(['색상 저장', 'ICC 프로필', profile || undefined]);
  else if (source === 'EXIF') rows.push(['색상 저장', 'EXIF 색공간 태그']);
  const duplicate = color && color.toLowerCase() === profile.toLowerCase()
    || color === 'Display P3' && profile === 'sRGB EOTF with DCI-P3 Color Gamut';
  if (profile && !duplicate) rows.push(['색상 프로필', profile]);
  return rows;
}

// Only report recorded fields. Gain-map coefficients are not measured screen
// luminance; display headroom is a separate ratio to ordinary SDR white.
export function photoHdrRows(info?: Partial<PhotoFileInfo> | null): [string, string, string?][] {
  const details = info?.hdrDetails;
  const formats = Array.isArray(details?.formats) ? details.formats.filter(value => typeof value === 'string' && value) : [];
  const methods: string[] = [];
  const adobeVersion = Array.isArray(details?.versions) ? details.versions.find(value => typeof value === 'string' && /^Adobe \d+(?:\.\d+){0,3}$/u.test(value))?.slice(6) : '';
  for (const format of formats) {
    const name = format === 'Apple HDR 게인맵' ? 'Apple' : format === 'Adobe HDR 게인맵' ? 'Adobe XMP' + (adobeVersion ? ' ' + adobeVersion : '') : format === 'ISO 21496-1 게인맵' ? 'ISO 21496-1' : format;
    if (!methods.includes(name)) methods.push(name);
  }
  const rows: [string, string, string?][] = [['HDR 규격', methods.length ? methods.join(' · ') : info?.hdr === 'not-indicated' ? '확인된 기록 없음' : '미확인']];
  if (Array.isArray(details?.versions) && details.versions.length) rows[0].push('파일에 기록된 버전: ' + details.versions.join(' · '));
  const image = details?.gainMapImage;
  const validImage = image?.format === 'JPEG' && Number.isSafeInteger(image.width) && image.width > 0 && Number.isSafeInteger(image.height) && image.height > 0 && Number.isSafeInteger(image.channels) && image.channels > 0;
  if (validImage) rows.push(['게인맵', 'JPEG · ' + image.width + ' × ' + image.height + ' · ' + (image.channels === 1 ? '흑백' : image.channels === 3 ? 'RGB' : image.channels + '채널'), '보조 JPEG의 헤더와 끝표지를 확인했습니다. 영상 디코딩이나 원본과의 동일성 검사는 아닙니다.']);
  else if (formats.some(format => ['Apple HDR 게인맵','Adobe HDR 게인맵','ISO 21496-1 게인맵'].includes(format))) rows.push(['게인맵 영상', '미확인', 'HDR 규격 표시는 있으나 보조 영상은 확인하지 못했습니다.']);
  // Anonymous array callbacks avoid Worker keepNames helper dependencies when
  // this function is serialized into a standalone browser context.
  const [number,ratio,range,validValues] = [
    (value: number) => String(Number(value.toFixed(2))),
    (value: number) => {
      const factor = 2 ** value;
      if (!Number.isFinite(factor) || factor <= 0) return null;
      return factor < 0.01 || factor >= 10000 ? String(Number(factor.toPrecision(3))) : number(factor);
    },
    (low: number, high: number) => {
      const min = ratio(low), max = ratio(high), stops = low === high ? number(low) : number(low) + '~' + number(high);
      return min !== null && max !== null ? (min === max ? min : min + '~' + max) + '배 (' + stops + '스톱)' : stops + '스톱';
    },
    (values: unknown): values is number[] => Array.isArray(values) && [1,3].includes(values.length) && values.every(value => typeof value === 'number' && Number.isFinite(value)),
  ] as const;
  const low = details?.gainMapMin, high = details?.gainMapMax;
  const lowValid = validValues(low), highValid = validValues(high);
  const coefficientNote = '파일에 기록된 밝기 보정 계수입니다. 1스톱은 2배이며 실제 화면 밝기를 측정한 값은 아닙니다.' + (details?.parameterSource ? ' 수치 출처: ' + ({adobe:'Adobe XMP',iso:'ISO 21496-1',apple:'Apple'}[details.parameterSource]) : '');
  if (lowValid || highValid) {
    const count = Math.max(lowValid ? low.length : 1, highValid ? high.length : 1), values: string[] = [];
    for (let index = 0; index < count; index++) {
      const minimum = lowValid ? low[index % low.length] : high![index % high!.length], maximum = highValid ? high[index % high.length] : minimum;
      values.push(range(minimum, maximum));
    }
    rows.push([lowValid && highValid ? '밝기 보정값' : lowValid ? '밝기 보정 최소값' : '밝기 보정 최대값', values.every(value => value === values[0]) ? values[0] : values.map((value,index) => ['R','G','B'][index] + ' ' + value).join(' · '), coefficientNote]);
  }
  for (const [value,label] of [[details?.hdrCapacityMin,'HDR 적용 시작 기준'],[details?.hdrCapacityMax,'HDR 전체 적용 기준']] as const) {
    if (typeof value !== 'number' || !Number.isFinite(value)) continue;
    const factor = ratio(value);
    rows.push([label, factor === null ? number(value) + '스톱' : '화면 밝기 여유 ' + factor + '배 (' + number(value) + '스톱)', '화면의 HDR 흰색 밝기를 일반(SDR) 흰색으로 나눈 비율입니다. 현재 화면이나 사진의 최대 밝기를 측정한 값은 아닙니다.']);
  }
  if (typeof details?.appleHeadroom === 'number' && Number.isFinite(details.appleHeadroom) && details.appleHeadroom > 0) rows.push(['HDR 밝기 여유', number(details.appleHeadroom) + '배', 'Apple에 기록된 일반(SDR) 흰색 대비 밝기 여유입니다. 이미 배수로 기록된 값입니다.']);
  if (typeof details?.baseRenditionIsHDR === 'boolean') rows.push(['기본 사진', details.baseRenditionIsHDR ? 'HDR' : 'SDR']);
  return rows;
}
