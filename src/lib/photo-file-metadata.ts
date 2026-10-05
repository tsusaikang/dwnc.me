// Metadata inspection only: never decode pixels, rewrite a file, or infer JPEG
// quality. A prefix cannot verify an appended HDR gain-map image's contents.
export interface PhotoHdrDetails {
  formats: string[];
  versions?: string[];
  parameterSource?: 'adobe' | 'iso' | 'apple';
  // Recorded log2 values (stops), retaining one or three channels. Missing
  // fields stay missing even when a format defines rendering defaults.
  gainMapMin?: number[];
  gainMapMax?: number[];
  hdrCapacityMin?: number;
  hdrCapacityMax?: number;
  // Apple's recorded headroom is a linear ratio to SDR white, not log2.
  appleHeadroom?: number;
  baseRenditionIsHDR?: boolean;
}

export interface PhotoFileInfo {
  format: string | null;
  bytes: number;
  width: number | null;
  height: number | null;
  colorSpace: string | null;
  profileName: string | null;
  hdr: 'metadata-present' | 'not-indicated' | 'unknown';
  hdrDetails?: PhotoHdrDetails;
  metadataComplete: boolean;
}

export const PHOTO_METADATA_PREFIX_BYTES = 256 * 1024;
const ascii = new TextDecoder('latin1');
const text = (bytes: Uint8Array, at: number, length: number) => ascii.decode(bytes.subarray(at, at + length));
const starts = (bytes: Uint8Array, prefix: string) => text(bytes, 0, prefix.length) === prefix;
const XMP_HEADER = 'http://ns.adobe.com/xap/1.0/\0';
const EXTENDED_XMP_HEADER = 'http://ns.adobe.com/xmp/extension/\0';
const ISO_GAIN_MAP_HEADER = 'urn:iso:std:iso:ts:21496:-1\0';
const ADOBE_HDR_NS = 'http://ns.adobe.com/hdr-gain-map/1.0/';
const APPLE_HDR_NS = 'http://ns.apple.com/HDRGainMap/1.0/';
const APPLE_PIXEL_NS = 'http://ns.apple.com/pixeldatainfo/1.0/';
const APPLE_HDR_TYPE = 'urn:com:apple:photo:2020:aux:hdrgainmap';
const RDF_NS = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#';
const u16 = (bytes: Uint8Array, at: number, little = false) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint16(at, little);
const u32 = (bytes: Uint8Array, at: number, little = false) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(at, little);
const fixed = (bytes: Uint8Array, at: number) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getInt32(at) / 65536;
const label = (value: string) => value.replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/gu, '').trim().slice(0, 120) || null;

interface XmpNode {
  name: string;
  key: string;
  namespaces: Map<string, string>;
  attributes: Map<string, string>;
  children: XmpNode[];
  content: string;
}
const xmpKey = (namespace: string, name: string) => namespace + '\0' + name;
function xmlText(value: string): string | null {
  let valid = true;
  const decoded = value.replace(/&([^;]*);/gu, (_, entity: string) => {
    const named: Record<string, string> = {amp:'&',lt:'<',gt:'>',quot:'"',apos:"'"};
    if (Object.hasOwn(named, entity)) return named[entity];
    const numeric = /^#(?:([0-9]+)|x([0-9a-f]+))$/iu.exec(entity);
    const code = numeric ? parseInt(numeric[1] ?? numeric[2], numeric[1] ? 10 : 16) : 0;
    if (!code || code > 0x10ffff || code >= 0xd800 && code <= 0xdfff) { valid = false; return ''; }
    return String.fromCodePoint(code);
  });
  return valid && !/&[^;]*$/u.test(value) ? decoded : null;
}

// A small namespace-aware reader for scalar XMP and RDF sequences, not a
// general XML processor. No DTD/entity expansion or extended-XMP assembly.
function xmpNodes(input: string): XmpNode[] | null {
  const source = input.replace(/\0+$/u, ''), nodes: XmpNode[] = [];
  const root: XmpNode = {name:'',key:'',namespaces:new Map(),attributes:new Map(),children:[],content:''};
  const stack = [root];
  for (let at = 0; at < source.length;) {
    if (source[at] !== '<') {
      const end = source.indexOf('<', at), until = end < 0 ? source.length : end;
      const content = xmlText(source.slice(at, until));
      if (content === null) return null;
      stack.at(-1)!.content += content; at = until; continue;
    }
    if (source.startsWith('<!--', at) || source.startsWith('<?', at)) {
      const ending = source.startsWith('<!--', at) ? '-->' : '?>';
      const end = source.indexOf(ending, at + 2);
      if (end < 0) return null;
      at = end + ending.length; continue;
    }
    if (source.startsWith('<!', at)) return null;
    let end = at + 1, quote = '';
    for (; end < source.length; end++) {
      const character = source[end];
      if (quote) { if (character === quote) quote = ''; }
      else if (character === '"' || character === "'") quote = character;
      else if (character === '>') break;
    }
    if (end === source.length) return null;
    const tag = source.slice(at + 1, end);
    at = end + 1;
    if (tag.startsWith('/')) {
      if (stack.length === 1 || tag.slice(1).trim() !== stack.at(-1)!.name) return null;
      stack.pop(); continue;
    }
    const match = /^([A-Za-z_][\w.:-]*)([\s\S]*?)\/?$/u.exec(tag);
    if (!match || nodes.length >= 2048 || stack.length > 32) return null;
    const attributes = new Map<string, string>();
    let rest = match[2];
    while (rest.trim()) {
      const attribute = /^\s+([A-Za-z_][\w.:-]*)\s*=\s*(?:"([^"<]*)"|'([^'<]*)')/u.exec(rest);
      if (!attribute || attributes.size >= 128 || attributes.has(attribute[1])) return null;
      const value = xmlText(attribute[2] ?? attribute[3]);
      if (value === null) return null;
      attributes.set(attribute[1], value); rest = rest.slice(attribute[0].length);
    }
    const namespaces = new Map(stack.at(-1)!.namespaces);
    for (const [name, value] of attributes) {
      if (name === 'xmlns') namespaces.set('', value);
      else if (name.startsWith('xmlns:')) namespaces.set(name.slice(6), value);
    }
    if (namespaces.size > 64) return null;
    const expanded = (name: string, attr = false) => {
      const colon = name.indexOf(':'), prefix = colon < 0 ? '' : name.slice(0, colon);
      const namespace = attr && colon < 0 ? '' : namespaces.get(prefix) ?? '';
      return xmpKey(namespace, colon < 0 ? name : name.slice(colon + 1));
    };
    const node: XmpNode = {name:match[1],key:expanded(match[1]),namespaces,attributes:new Map(),children:[],content:''};
    for (const [name, value] of attributes) if (name !== 'xmlns' && !name.startsWith('xmlns:')) {
      const key = expanded(name, true);
      if (node.attributes.has(key)) return null;
      node.attributes.set(key, value);
    }
    stack.at(-1)!.children.push(node); nodes.push(node);
    if (!tag.endsWith('/')) stack.push(node);
  }
  return stack.length === 1 && root.children.length === 1 && !root.content.trim() ? nodes : null;
}

function xmpValues(nodes: XmpNode[], namespace: string, name: string): string[] | null {
  const key = xmpKey(namespace, name), candidates: (string[] | null)[] = [];
  for (const node of nodes) {
    if (node.attributes.has(key)) candidates.push([node.attributes.get(key)!]);
    if (node.key !== key) continue;
    if (!node.children.length) candidates.push([node.content.trim()]);
    else {
      const sequence = node.children[0];
      candidates.push(!node.content.trim() && node.children.length === 1 && sequence.key === xmpKey(RDF_NS, 'Seq') && !sequence.content.trim() && [1,3].includes(sequence.children.length) && sequence.children.every(child => child.key === xmpKey(RDF_NS, 'li') && !child.children.length)
        ? sequence.children.map(child => child.content.trim()) : null);
    }
  }
  return candidates.length === 1 ? candidates[0] : null;
}
function xmpNumber(value: string): number | null {
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/u.test(value.trim())) return null;
  const number = Number(value); return Number.isFinite(number) ? number : null;
}
function xmpHdrInfo(xmp: string): PhotoHdrDetails[] {
  const nodes = xmpNodes(xmp);
  if (!nodes) return [];
  const records: PhotoHdrDetails[] = [];
  const scalar = (namespace: string, name: string) => { const values = xmpValues(nodes, namespace, name); return values?.length === 1 ? values[0].trim() : null; };
  const numbers = (name: string) => {
    const values = xmpValues(nodes, ADOBE_HDR_NS, name);
    if (!values || ![1,3].includes(values.length)) return undefined;
    const parsed = values.map(xmpNumber); return parsed.every(value => value !== null) ? parsed as number[] : undefined;
  };
  if (nodes.some(node => [...node.namespaces.values()].includes(ADOBE_HDR_NS))) {
    const record: PhotoHdrDetails = {formats:['Adobe HDR 게인맵']};
    const version = scalar(ADOBE_HDR_NS, 'Version');
    if (version && /^\d+(?:\.\d+){0,3}$/u.test(version) && version.length < 32) record.versions = ['Adobe ' + version];
    if (version === '1.0') {
      let min = numbers('GainMapMin'), max = numbers('GainMapMax');
      if (min && max && Array.from({length:Math.max(min.length,max.length)}, (_,index) => min![index % min!.length] <= max![index % max!.length]).some(valid => !valid)) min = max = undefined;
      if (min) record.gainMapMin = min;
      if (max) record.gainMapMax = max;
      const minimum = xmpNumber(scalar(ADOBE_HDR_NS, 'HDRCapacityMin') ?? ''), maximum = xmpNumber(scalar(ADOBE_HDR_NS, 'HDRCapacityMax') ?? '');
      if (!(minimum !== null && maximum !== null && minimum >= maximum)) {
        if (minimum !== null && minimum >= 0) record.hdrCapacityMin = minimum;
        if (maximum !== null && maximum > 0) record.hdrCapacityMax = maximum;
      }
      const base = scalar(ADOBE_HDR_NS, 'BaseRenditionIsHDR');
      if (base === 'True' || base === 'False') record.baseRenditionIsHDR = base === 'True';
      if (Object.keys(record).some(key => !['formats','versions'].includes(key))) record.parameterSource = 'adobe';
    }
    records.push(record);
  }
  const appleVersion = scalar(APPLE_HDR_NS, 'HDRGainMapVersion');
  const appleType = scalar(APPLE_PIXEL_NS, 'AuxiliaryImageType');
  if (appleType === APPLE_HDR_TYPE || appleVersion !== null) {
    const record: PhotoHdrDetails = {formats:['Apple HDR 게인맵']};
    if (appleVersion && /^\d{1,10}$/u.test(appleVersion) && Number(appleVersion) <= 0x7fffffff) {
      record.versions = ['Apple ' + appleVersion];
      const headroom = xmpNumber(scalar(APPLE_HDR_NS, 'HDRGainMapHeadroom') ?? '');
      if (appleType === APPLE_HDR_TYPE && headroom !== null && headroom >= 1) { record.appleHeadroom = headroom; record.parameterSource = 'apple'; }
    }
    records.push(record);
  }
  return records;
}

function isoHdrInfo(bytes: Uint8Array): PhotoHdrDetails {
  const record: PhotoHdrDetails = {formats:['ISO 21496-1 게인맵']};
  if (bytes.length < 4) return record;
  const minimumVersion = u16(bytes, 0), writerVersion = u16(bytes, 2);
  record.versions = [`ISO 작성 ${writerVersion} · 최소 ${minimumVersion}`];
  // Version 0 uses independent rational pairs; the low flag bits are reserved.
  // Unknown versions/layouts retain their declaration, not guessed numbers.
  if (minimumVersion !== 0 || writerVersion !== 0 || bytes.length < 5 || (bytes[4] & 0x3f)) return record;
  const channels = bytes[4] & 0x80 ? 3 : 1;
  if (bytes.length !== 21 + channels * 40) return record;
  let at = 5;
  const fraction = (signed = false) => {
    const numerator = signed ? new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength).getInt32(at) : u32(bytes,at), denominator = u32(bytes,at+4);
    at += 8; return denominator ? numerator / denominator : NaN;
  };
  const minimum = fraction(), maximum = fraction(), min: number[] = [], max: number[] = [];
  let valid = Number.isFinite(minimum) && Number.isFinite(maximum) && minimum >= 0 && maximum > minimum;
  for (let channel = 0; channel < channels; channel++) {
    const low = fraction(true), high = fraction(true), gamma = fraction(), baseOffset = fraction(true), alternateOffset = fraction(true);
    valid &&= [low,high,gamma,baseOffset,alternateOffset].every(Number.isFinite) && low <= high && gamma > 0 && baseOffset >= 0 && alternateOffset >= 0;
    min.push(low); max.push(high);
  }
  if (valid) Object.assign(record, {parameterSource:'iso',gainMapMin:min,gainMapMax:max,hdrCapacityMin:minimum,hdrCapacityMax:maximum});
  return record;
}

function combineHdrInfo(records: PhotoHdrDetails[]): PhotoHdrDetails | undefined {
  if (!records.length) return undefined;
  const details: PhotoHdrDetails = {formats:[...new Set(records.flatMap(record => record.formats))]};
  const versions = [...new Set(records.flatMap(record => record.versions ?? []))];
  if (versions.length) details.versions = versions;
  // Keep one parameter scheme; conflicting repeated records are ambiguous.
  for (const source of ['iso','adobe','apple'] as const) {
    const parameters = records.filter(record => record.parameterSource === source).map(({formats,versions,...values}) => values);
    if (!parameters.length) continue;
    if (parameters.every(values => JSON.stringify(values) === JSON.stringify(parameters[0]))) Object.assign(details, parameters[0]);
    break;
  }
  return details;
}

function exif(bytes: Uint8Array) {
  const result = {orientation: 1, srgb: false};
  if (bytes.length < 14 || text(bytes, 0, 6) !== 'Exif\0\0') return result;
  const tiff = bytes.subarray(6), order = text(tiff, 0, 2), little = order === 'II';
  if (!['II','MM'].includes(order) || u16(tiff, 2, little) !== 42) return result;
  function directory(at: number, nested = false) {
    if (at < 8 || at + 2 > tiff.length) return;
    const count = u16(tiff, at, little);
    if (count > 512 || at + 2 + count * 12 > tiff.length) return;
    for (let index = 0; index < count; index++) {
      const entry = at + 2 + index * 12, tag = u16(tiff, entry, little), type = u16(tiff, entry + 2, little), size = u32(tiff, entry + 4, little);
      if (type === 3 && size === 1) {
        const value = u16(tiff, entry + 8, little);
        if (tag === 0x0112 && value >= 1 && value <= 8) result.orientation = value;
        if (tag === 0xa001 && value === 1) result.srgb = true;
      }
      if (!nested && tag === 0x8769 && type === 4 && size === 1) directory(u32(tiff, entry + 8, little), true);
    }
  }
  directory(u32(tiff, 4, little));
  return result;
}

function srgbCurve(bytes: Uint8Array): boolean {
  if (bytes.length < 12) return false;
  const kind = text(bytes, 0, 4), count = u32(bytes, 8);
  const fn = kind === 'para' ? u16(bytes, 8) : -1;
  if (kind === 'curv' && (count > 32768 || 12 + count * 2 > bytes.length)) return false;
  if (kind === 'para' && (fn > 4 || 12 + [1,3,4,5,7][fn] * 4 > bytes.length)) return false;
  if (kind !== 'curv' && kind !== 'para') return false;
  // Compare the defined curve, not its description. The same matrices with a
  // different transfer curve must not be called sRGB or Display P3.
  for (const x of [0, 0.01, 0.04, 0.1, 0.25, 0.5, 0.75, 1]) {
    let value: number;
    if (kind === 'curv') {
      if (!count) value = x;
      else if (count === 1) value = x ** (u16(bytes, 12) / 256);
      else {
        const position = x * (count - 1), index = Math.min(Math.floor(position), count - 2), fraction = position - index;
        value = (u16(bytes, 12 + index * 2) * (1 - fraction) + u16(bytes, 14 + index * 2) * fraction) / 65535;
      }
    } else {
      const g = fixed(bytes, 12), a = fn ? fixed(bytes, 16) : 1, b = fn ? fixed(bytes, 20) : 0;
      const c = fn >= 2 ? fixed(bytes, 24) : 0, d = fn >= 3 ? fixed(bytes, 28) : 0;
      const e = fn === 4 ? fixed(bytes, 32) : 0, f = fn === 4 ? fixed(bytes, 36) : 0;
      if (fn && !a) return false;
      value = !fn ? x ** g : fn <= 2 ? (x >= -b / a ? (a * x + b) ** g : 0) + (fn === 2 ? c : 0) : x >= d ? (a * x + b) ** g + e : c * x + f;
    }
    const expected = x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
    if (!Number.isFinite(value) || Math.abs(value - expected) > 0.002) return false;
  }
  return true;
}

function iccInfo(bytes: Uint8Array): {profileName: string | null; colorSpace: string | null} {
  const result = {profileName: null as string | null, colorSpace: null as string | null};
  if (bytes.length < 132 || text(bytes, 36, 4) !== 'acsp') return result;
  const size = u32(bytes, 0), count = u32(bytes, 128);
  if (size > bytes.length || size < 132 || count > 512 || 132 + count * 12 > size) return result;
  const tags = new Map<string, Uint8Array>();
  for (let index = 0; index < count; index++) {
    const at = 132 + index * 12, name = text(bytes, at, 4), offset = u32(bytes, at + 4), length = u32(bytes, at + 8);
    if (offset < 128 || length < 8 || offset + length > size || tags.has(name)) return result;
    tags.set(name, bytes.subarray(offset, offset + length));
  }
  const description = tags.get('desc');
  if (description && description.length >= 12) {
    const kind = text(description, 0, 4);
    if (kind === 'desc') {
      const length = u32(description, 8);
      if (length > 0 && length <= description.length - 12) result.profileName = label(text(description, 12, length));
    } else if (kind === 'mluc' && description.length >= 28 && u32(description, 8) > 0 && u32(description, 12) === 12) {
      const length = u32(description, 20), offset = u32(description, 24);
      if (length % 2 === 0 && offset >= 28 && offset + length <= description.length) result.profileName = label(new TextDecoder('utf-16be').decode(description.subarray(offset, offset + length)));
    }
  }
  if (text(bytes, 16, 4) !== 'RGB ' || text(bytes, 20, 4) !== 'XYZ ') return result;
  // LUT profiles may override matrix/TRC tags. Report their name without
  // guessing which transform the image renderer will use.
  if ([...tags.keys()].some(name => /^(?:A2B|B2A|D2B|B2D)/u.test(name))) return result;
  const matrix: number[] = [];
  for (const channel of ['r','g','b']) {
    const xyz = tags.get(channel + 'XYZ'), curve = tags.get(channel + 'TRC');
    if (!xyz || xyz.length < 20 || text(xyz, 0, 4) !== 'XYZ ' || !curve || !srgbCurve(curve)) return result;
    matrix.push(fixed(xyz, 8), fixed(xyz, 12), fixed(xyz, 16));
  }
  // Standard D50-adapted colorants; a narrow tolerance accommodates ICC fixed
  // point rounding and compact P3 profiles that clamp the tiny negative red Z.
  // ICC profile names alone never select a color-space label.
  const standards: [string, number[]][] = [
    ['sRGB', [0.43607,0.22249,0.01392, 0.38506,0.71688,0.09710, 0.14308,0.06062,0.71417]],
    ['Display P3', [0.51510,0.24118,-0.00105, 0.29198,0.69224,0.04188, 0.15710,0.06658,0.78438]],
  ];
  result.colorSpace = standards.find(([,values]) => values.every((value,index) => Math.abs(matrix[index] - value) < 0.002))?.[0] ?? null;
  return result;
}

function jpegInfo(bytes: Uint8Array, result: PhotoFileInfo) {
  result.format = 'JPEG';
  let at = 2, orientation = 1, exifSrgb = false, iccCount = 0, iccInvalid = false, extendedXmp = false;
  const chunks = new Map<number, Uint8Array>();
  const hdrRecords: PhotoHdrDetails[] = [];
  while (at + 2 <= bytes.length) {
    if (bytes[at++] !== 255) break;
    while (at < bytes.length && bytes[at] === 255) at++;
    const marker = bytes[at++];
    if (marker === 0xd9) break;
    if (marker === 0 || marker === 0xd8 || marker === 1 || marker >= 0xd0 && marker <= 0xd7 || at + 2 > bytes.length) break;
    const length = u16(bytes, at);
    if (length < 2 || at + length > bytes.length) break;
    const body = bytes.subarray(at + 2, at + length);
    if (marker === 0xda) { result.metadataComplete = Boolean(result.width && result.height); break; }
    if ([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker) && body.length >= 6) {
      result.height = u16(body, 1) || null; result.width = u16(body, 3) || null;
    }
    if (marker === 0xe1) {
      const metadata = exif(body); orientation = metadata.orientation !== 1 ? metadata.orientation : orientation; exifSrgb ||= metadata.srgb;
      if (starts(body, XMP_HEADER)) {
        const xmp = text(body, XMP_HEADER.length, body.length - XMP_HEADER.length);
        if (/http:\/\/ns\.adobe\.com\/hdr-gain-map\/1\.0\/|HDRGainMap|urn:com:apple:photo:2020:aux:hdrgainmap/u.test(xmp)) result.hdr = 'metadata-present';
        hdrRecords.push(...xmpHdrInfo(xmp));
      }
      if (starts(body, EXTENDED_XMP_HEADER)) extendedXmp = true;
    }
    if (marker === 0xe2) {
      if (starts(body, ISO_GAIN_MAP_HEADER)) { result.hdr = 'metadata-present'; hdrRecords.push(isoHdrInfo(body.subarray(ISO_GAIN_MAP_HEADER.length))); }
      if (text(body, 0, 12) === 'ICC_PROFILE\0') {
        const index = body[12], count = body[13];
        if (body.length < 14 || !index || !count || index > count || iccCount && count !== iccCount || chunks.has(index)) iccInvalid = true;
        else { iccCount = count; chunks.set(index, body.subarray(14)); }
      }
      // MPF alone can describe bursts or stereo images, not necessarily HDR.
    }
    at += length;
  }
  if (orientation >= 5 && orientation <= 8) [result.width, result.height] = [result.height, result.width];
  if (iccCount && chunks.size === iccCount && !iccInvalid) {
    const joined = new Uint8Array([...chunks.values()].reduce((sum,chunk) => sum + chunk.length, 0));
    let offset = 0;
    for (let index = 1; index <= iccCount; index++) { const chunk = chunks.get(index)!; joined.set(chunk, offset); offset += chunk.length; }
    Object.assign(result, iccInfo(joined));
  } else if (!iccCount && !iccInvalid && exifSrgb) result.colorSpace = 'sRGB';
  if (iccInvalid || chunks.size !== iccCount || extendedXmp) result.metadataComplete = false;
  const details = combineHdrInfo(hdrRecords);
  if (details) { result.hdrDetails = details; result.hdr = 'metadata-present'; }
  if (result.hdr === 'unknown' && result.metadataComplete) result.hdr = 'not-indicated';
}

export function inspectPhotoPrefix(input: Uint8Array, size: number, mime: string): PhotoFileInfo {
  const bytes = input.subarray(0, PHOTO_METADATA_PREFIX_BYTES);
  const result: PhotoFileInfo = {format:null, bytes:size, width:null, height:null, colorSpace:null, profileName:null, hdr:'unknown', metadataComplete:false};
  if (bytes.length >= 2 && bytes[0] === 255 && bytes[1] === 216) jpegInfo(bytes, result);
  else if (bytes.length >= 24 && bytes[0] === 137 && text(bytes, 1, 7) === 'PNG\r\n\x1a\n' && text(bytes, 12, 4) === 'IHDR') {
    result.format = 'PNG'; result.width = u32(bytes, 16) || null; result.height = u32(bytes, 20) || null;
  } else if (bytes.length >= 10 && ['GIF87a','GIF89a'].includes(text(bytes, 0, 6))) {
    result.format = 'GIF'; result.width = u16(bytes, 6, true) || null; result.height = u16(bytes, 8, true) || null;
  } else if (bytes.length >= 16 && text(bytes, 0, 4) === 'RIFF' && text(bytes, 8, 4) === 'WEBP') {
    result.format = 'WebP';
    for (let at = 12; at + 8 <= bytes.length;) {
      const kind = text(bytes, at, 4), length = u32(bytes, at + 4, true), body = at + 8;
      if (body + length > bytes.length) break;
      if (kind === 'VP8X' && length >= 10) {
        result.width = 1 + bytes[body + 4] + bytes[body + 5] * 256 + bytes[body + 6] * 65536;
        result.height = 1 + bytes[body + 7] + bytes[body + 8] * 256 + bytes[body + 9] * 65536;
      } else if (kind === 'VP8 ' && length >= 10 && text(bytes, body + 3, 3) === '\x9d\x01\x2a') {
        result.width = u16(bytes, body + 6, true) & 0x3fff; result.height = u16(bytes, body + 8, true) & 0x3fff;
      } else if (kind === 'VP8L' && length >= 5 && bytes[body] === 47) {
        const bits = u32(bytes, body + 1, true); result.width = (bits & 0x3fff) + 1; result.height = ((bits >>> 14) & 0x3fff) + 1;
      } else if (kind === 'ICCP') Object.assign(result, iccInfo(bytes.subarray(body, body + length)));
      at = body + length + (length % 2);
    }
  } else if (bytes.length >= 16 && text(bytes, 4, 4) === 'ftyp' && /avif|avis/u.test(text(bytes, 8, Math.min(bytes.length - 8, u32(bytes, 0) - 8)))) result.format = 'AVIF';
  else if (mime === 'image/svg+xml') result.format = 'SVG';
  // Other containers retain unknown color/HDR metadata. Client image decoding
  // can supply their displayed dimensions without another file download.
  return result;
}
