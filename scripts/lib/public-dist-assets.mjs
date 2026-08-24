import { createHash } from 'node:crypto';
import path from 'node:path';
import {
  inspectRealPathChain,
  readSecureBytes,
  SequenceError,
} from './global-sequence.mjs';

const fail = (code) => { throw new SequenceError(code); };
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const MIME_PATTERN = /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/u;

function beginsWithHtmlDocument(bytes) {
  const prefix = bytes.subarray(0, 4096).toString('utf8').replace(/^(?:\uFEFF|\s)+/u, '');
  return /^(?:<!doctype\s+html\b|<html(?:\s|>))/iu.test(prefix);
}

function knownMimeMatches(mime, bytes) {
  if (mime === 'image/jpeg') return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (mime === 'image/png') return bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'));
  if (mime === 'image/gif') return /^GIF8[79]a/u.test(bytes.subarray(0, 6).toString('ascii'));
  if (mime === 'image/webp') return bytes.subarray(0, 4).toString('ascii') === 'RIFF'
    && bytes.subarray(8, 12).toString('ascii') === 'WEBP';
  if (mime === 'image/x-icon') {
    const kind = bytes.length >= 4 ? bytes.readUInt16LE(2) : 0;
    return bytes.length >= 4 && bytes[0] === 0 && bytes[1] === 0 && (kind === 1 || kind === 2);
  }
  if (mime === 'image/svg+xml') {
    const prefix = bytes.subarray(0, 4096).toString('utf8').replace(/^(?:\uFEFF|\s|<\?xml[^>]*>)+/iu, '');
    return /^<svg(?:\s|>)/iu.test(prefix);
  }
  if (mime === 'video/mp4') return bytes.length >= 12 && bytes.subarray(4, 8).toString('ascii') === 'ftyp';
  if (mime === 'application/pdf') return bytes.subarray(0, 5).toString('ascii') === '%PDF-';
  if (mime === 'application/zip') return bytes.subarray(0, 4).equals(Buffer.from('504b0304', 'hex'));
  return true;
}

export async function validateProjectedDistAssets(distRoot, contentRows) {
  const rootStats = await inspectRealPathChain(distRoot);
  if (!rootStats?.isDirectory()) fail('SEQ_E_DIST_ASSET_ROOT');
  const paths = new Map();
  const bySource = { tistory: 0, naver: 0, native: 0 };
  for (const row of contentRows) {
    if (!['tistory', 'naver', 'native'].includes(row?.source)
      || typeof row?.sourceId !== 'string'
      || !Array.isArray(row?.assetEvidence)) fail('SEQ_E_DIST_ASSET_EVIDENCE');
    const prefix = `/media/${row.source}/${row.sourceId}/`;
    for (const evidence of row.assetEvidence) {
      const mime = String(evidence?.mime ?? '').trim().toLowerCase();
      if (!evidence || typeof evidence.path !== 'string'
        || !evidence.path.startsWith(prefix)
        || !/^[a-f0-9]{64}$/u.test(evidence.sha256 ?? '')
        || !Number.isSafeInteger(evidence.size)
        || evidence.size <= 0
        || !MIME_PATTERN.test(mime)) fail('SEQ_E_DIST_ASSET_EVIDENCE');
      const existing = paths.get(evidence.path);
      if (existing && (existing.sha256 !== evidence.sha256
        || existing.size !== evidence.size
        || existing.mime !== mime)) fail('SEQ_E_DIST_ASSET_COLLISION');
      if (existing) continue;
      const absolute = path.resolve(distRoot, evidence.path.replace(/^\/+/, ''));
      if (!absolute.startsWith(`${path.resolve(distRoot)}${path.sep}`)) fail('SEQ_E_DIST_ASSET_PATH');
      let bytes;
      try { bytes = await readSecureBytes(absolute); }
      catch { fail('SEQ_E_DIST_ASSET_MISSING'); }
      if (bytes.length !== evidence.size) fail('SEQ_E_DIST_ASSET_SIZE');
      if (sha256(bytes) !== evidence.sha256) fail('SEQ_E_DIST_ASSET_SHA256');
      if (['text/html', 'application/xhtml+xml'].includes(mime) || beginsWithHtmlDocument(bytes)) {
        fail('SEQ_E_DIST_ASSET_HTML');
      }
      if (!knownMimeMatches(mime, bytes)) fail('SEQ_E_DIST_ASSET_MIME');
      paths.set(evidence.path, { sha256: evidence.sha256, size: evidence.size, mime });
      bySource[row.source] += 1;
    }
  }
  return {
    total: paths.size,
    bySource,
    paths: [...paths.keys()].sort((left, right) => left.localeCompare(right, 'en')),
  };
}
