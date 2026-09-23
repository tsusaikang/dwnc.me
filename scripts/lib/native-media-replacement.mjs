// Prepares a single atomic metadata change; it never uploads, deletes, or runs SQL.
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;
const KEY = /^media\/native\/[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}\.(?:jpg|png|webp|avif)$/u;
const SHA = /^[a-f0-9]{64}$/u;
const EXTENSIONS = new Map([['image/jpeg','jpg'],['image/png','png'],['image/webp','webp'],['image/avif','avif']]);
const fail = () => { throw new Error('NATIVE_MEDIA_REPLACEMENT_INVALID'); };
const quote = value => typeof value === 'number' ? String(value) : `'${value.replaceAll("'", "''")}'`;

export function nativeMediaReplacementSql(replacements) {
  if (!Array.isArray(replacements) || !replacements.length || replacements.length > 100) fail();
  const ids = new Set(), oldKeys = new Set(), newKeys = new Set(), paths = new Set();
  const rows = replacements.map(entry => {
    if (!entry || !UUID.test(entry.id ?? '') || !UUID.test(entry.post_id ?? '')
      || typeof entry.public_path !== 'string' || !KEY.test(entry.public_path.slice(1)) || !entry.public_path.startsWith('/')) fail();
    const old = entry.expected, next = entry.replacement;
    for (const value of [old, next]) {
      if (!value || !KEY.test(value.object_key ?? '') || !SHA.test(value.sha256 ?? '')
        || !Number.isSafeInteger(value.bytes) || value.bytes < 1 || value.bytes > 25 * 1024 * 1024
        || !EXTENSIONS.has(value.mime) || !value.object_key.endsWith('.' + EXTENSIONS.get(value.mime))) fail();
    }
    if (old.object_key === next.object_key || next.bytes >= old.bytes || old.sha256 === next.sha256
      || ids.has(entry.id) || oldKeys.has(old.object_key) || newKeys.has(next.object_key) || paths.has(entry.public_path)) fail();
    ids.add(entry.id); oldKeys.add(old.object_key); newKeys.add(next.object_key); paths.add(entry.public_path);
    return [entry.id, entry.post_id, entry.public_path, old.object_key, old.sha256, old.bytes, old.mime, next.object_key, next.sha256, next.bytes, next.mime];
  });
  if ([...newKeys].some(key => oldKeys.has(key))) fail();
  // MATERIALIZED keeps the all-or-nothing eligibility set fixed while UPDATE
  // changes the rows. If even one current row differs, no rows are changed.
  return `WITH replacements(id,post_id,public_path,old_key,old_sha,old_bytes,old_mime,new_key,new_sha,new_bytes,new_mime) AS (
  VALUES ${rows.map(row => '(' + row.map(quote).join(',') + ')').join(',\n  ')}
), eligible AS MATERIALIZED (
  SELECT m.id FROM native_media m JOIN replacements r ON r.id=m.id
  WHERE m.post_id=r.post_id AND m.public_path=r.public_path
    AND m.object_key=r.old_key AND m.sha256=r.old_sha AND m.bytes=r.old_bytes AND m.mime=r.old_mime
    AND EXISTS(SELECT 1 FROM native_posts p WHERE p.id=m.post_id AND p.status!='tombstone')
)
UPDATE native_media AS m SET
  object_key=(SELECT new_key FROM replacements r WHERE r.id=m.id),
  sha256=(SELECT new_sha FROM replacements r WHERE r.id=m.id),
  bytes=(SELECT new_bytes FROM replacements r WHERE r.id=m.id),
  mime=(SELECT new_mime FROM replacements r WHERE r.id=m.id)
WHERE id IN (SELECT id FROM eligible) AND (SELECT COUNT(*) FROM eligible)=${rows.length}
RETURNING id,object_key,sha256,bytes,mime;\n`;
}
