// Some image exporters leave legacy HDR XMP after removing the gain-map image.
// Remove that declaration only when the entire file is one complete JPEG with
// no MPF/ISO gain-map contract. Never decode/re-encode pixels or touch ICC/EXIF.
export function removeOrphanHdrXmp(buffer) {
  const bytes = new Uint8Array(buffer), size = bytes.length;
  if (size < 4 || bytes[0] !== 255 || bytes[1] !== 216) return buffer;
  const ascii = new TextDecoder('utf-8');
  const xmpHeader = 'http://ns.adobe.com/xap/1.0/\0';
  const extendedXmpHeader = 'http://ns.adobe.com/xmp/extension/\0';
  const isoHeader = 'urn:iso:std:iso:ts:21496:-1';
  const removals = [];
  let at = 2, entropy = false, scanned = false;
  while (at < size) {
    if (entropy) { while (at < size && bytes[at] !== 255) at++; }
    else if (bytes[at] !== 255) return buffer;
    const start = at;
    while (at < size && bytes[at] === 255) at++;
    if (at >= size) return buffer;
    const marker = bytes[at++];
    if (entropy && (marker === 0 || marker >= 0xd0 && marker <= 0xd7)) continue;
    entropy = false;
    if (marker === 0xd9) {
      // Trailing padding, appended JPEGs or other payloads are deliberately not
      // classified as stale metadata; unsupported HDR still fails explicitly.
      if (!scanned || at !== size || !removals.length) return buffer;
      const removed = removals.reduce((sum, [from, to]) => sum + to - from, 0);
      const clean = new Uint8Array(size - removed);
      let source = 0, target = 0;
      for (const [from, to] of removals) {
        clean.set(bytes.subarray(source, from), target);
        target += from - source; source = to;
      }
      clean.set(bytes.subarray(source), target);
      return clean.buffer;
    }
    if (marker === 0 || marker === 0xd8 || marker === 1 || marker >= 0xd0 && marker <= 0xd7 || at + 2 > size) return buffer;
    const length = bytes[at] * 256 + bytes[at + 1];
    if (length < 2 || length > size - at) return buffer;
    const end = at + length;
    if (marker === 0xe1 || marker === 0xe2) {
      const text = ascii.decode(bytes.subarray(at + 2, end));
      if (marker === 0xe2 && (text.startsWith('MPF\0') || text.startsWith(isoHeader))) return buffer;
      // Extended XMP could carry an additional image contract; do not guess.
      if (marker === 0xe1 && text.startsWith(extendedXmpHeader)) return buffer;
      if (marker === 0xe1 && text.startsWith(xmpHeader) && text.includes('http://ns.adobe.com/hdr-gain-map/1.0/')) removals.push([start, end]);
    }
    at = end;
    if (marker === 0xda) { scanned = true; entropy = true; }
  }
  return buffer;
}
