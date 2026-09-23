import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { createEditorDatabase } from './fixtures/editor-database.mjs';
import { NativePostStore } from '../src/lib/native-post-store.ts';
import { CmsConfigurationStore } from '../src/lib/cms-configuration.ts';
import { createNativePublicWorker, serveAdminNativeMedia } from '../src/lib/native-public-worker.ts';
import { nativeMediaReplacementSql } from './lib/native-media-replacement.mjs';

const db = await createEditorDatabase(), store = new NativePostStore(db);
const category = (await new CmsConfigurationStore(db).categories()).value[0];
let post = await store.createDraft(category);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const objects = new Map(), replacements = [];
for (let i=0;i<3;i++) {
  const id=randomUUID(), public_path=`/media/native/${id}.png`;
  const oldData=Buffer.from('large synthetic old image '.repeat(10)+i),newData=Buffer.from('compact JPEG '+i);
  const expected={object_key:public_path.slice(1),sha256:sha(oldData),bytes:oldData.length,mime:'image/png'};
  const replacement={object_key:`media/native/${randomUUID()}.jpg`,sha256:sha(newData),bytes:newData.length,mime:'image/jpeg'};
  await store.addMedia({id,postId:post.id,publicPath:public_path,objectKey:expected.object_key,sha256:expected.sha256,bytes:expected.bytes,mime:expected.mime,alt:'keep caption '+i,createdAt:'2026-09-23T00:00:00Z'});
  replacements.push({id,post_id:post.id,public_path,expected,replacement});
  for(const [metadata,bytes] of [[expected,oldData],[replacement,newData]]) objects.set(metadata.object_key,{metadata,bytes});
}
post=await store.update(post.id,post.revision,{...post,title:'Synthetic published snapshot',bodyFormat:'html',bodyMarkdown:`<p>Published text</p><img src="${replacements[0].public_path}" alt="kept">`});
post=await store.publish(post.id,post.revision);
post=await store.update(post.id,post.revision,{...post,title:'Unpublished user edit',bodyMarkdown:`<p>Unpublished text</p><img src="${replacements[1].public_path}" alt="draft">`});
const tableSnapshot=table=>db.sqlite.prepare(`SELECT * FROM ${table} ORDER BY 1`).all();
const unchangedTables=['native_posts','editor_working_copies','content_operations'];
const before=new Map(unchangedTables.map(t=>[t,tableSnapshot(t)]));
const originalRows=tableSnapshot('native_media');
const sql=nativeMediaReplacementSql(replacements);

// A stale expected row prevents the entire group from changing.
db.sqlite.prepare('UPDATE native_media SET bytes=bytes+1 WHERE id=?').run(replacements[1].id);
assert.deepEqual(db.sqlite.prepare(sql).all(),[]);
assert.equal(db.sqlite.prepare('SELECT object_key FROM native_media WHERE id=?').get(replacements[0].id).object_key,replacements[0].expected.object_key);
db.sqlite.prepare('UPDATE native_media SET bytes=bytes-1 WHERE id=?').run(replacements[1].id);
// An upload API creates its own media row. Its key cannot silently be reused:
// uniqueness aborts the whole statement, including any earlier updated row.
const stagedId=randomUUID(),stagedPath=`/media/native/${stagedId}.jpg`,staged=replacements[1].replacement;
await store.addMedia({id:stagedId,postId:post.id,publicPath:stagedPath,objectKey:staged.object_key,sha256:staged.sha256,bytes:staged.bytes,mime:staged.mime,alt:'staged fixture',createdAt:'2026-09-23T00:00:00Z'});
assert.throws(()=>db.sqlite.prepare(sql).all(),/UNIQUE/);
for(const original of originalRows)assert.deepEqual(db.sqlite.prepare('SELECT * FROM native_media WHERE id=?').get(original.id),original);
db.sqlite.prepare('DELETE FROM native_media WHERE id=?').run(stagedId);
const result=db.sqlite.prepare(sql).all();assert.equal(result.length,3);
for(const table of unchangedTables)assert.deepEqual(tableSnapshot(table),before.get(table));
for(const original of originalRows){const now=db.sqlite.prepare('SELECT * FROM native_media WHERE id=?').get(original.id);for(const field of ['id','post_id','public_path','alt','created_at'])assert.equal(now[field],original[field]);}
assert.deepEqual(db.sqlite.prepare(sql).all(),[]); // replay cannot overwrite a later version

let reads=0;
const getObject=async key=>{reads++;const entry=objects.get(key);if(!entry)return null;const {metadata,bytes}=entry;return{size:metadata.bytes,httpMetadata:{contentType:metadata.mime},customMetadata:{contract:'dwnc-native-media-v1',sha256:metadata.sha256},checksums:{sha256:Uint8Array.from(Buffer.from(metadata.sha256,'hex')).buffer},httpEtag:'"'+metadata.sha256+'"',body:bytes};};
const env={NATIVE_DB:db,NATIVE_MEDIA_BUCKET:{get:getObject,head:getObject}};
const publicWorker=createNativePublicWorker(async()=>new Response(null,{status:404}));
const url=entry=>'https://dwnc.me'+entry.public_path;
for(const method of ['GET','HEAD']){
  const response=await publicWorker(new Request(url(replacements[0]),{method}),env,{});
  assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),'image/jpeg');assert.equal(response.headers.get('cache-control'),'no-store');assert.equal(response.headers.get('content-length'),String(replacements[0].replacement.bytes));
  assert.equal((await response.arrayBuffer()).byteLength,method==='HEAD'?0:replacements[0].replacement.bytes);
}
// Working-copy-only and unused media remain unavailable publicly after remap.
for(const entry of replacements.slice(1)){const previousReads=reads;assert.equal((await publicWorker(new Request(url(entry)),env,{})).status,404);assert.equal(reads,previousReads);assert.equal((await serveAdminNativeMedia(new Request(url(entry)),env)).status,200);}
// Missing or mismatched new objects fail closed instead of serving unchecked bytes.
const key=replacements[0].replacement.object_key, entry=objects.get(key);objects.delete(key);
assert.equal((await publicWorker(new Request(url(replacements[0])),env,{})).status,404);objects.set(key,entry);
entry.metadata={...entry.metadata,mime:'image/png'};assert.equal((await serveAdminNativeMedia(new Request(url(replacements[0])),env)).status,404);entry.metadata=replacements[0].replacement;
// A concurrent privacy change remains authoritative without checking post revisions.
db.sqlite.prepare("INSERT INTO content_operations(post_id,kind,visibility) VALUES(?,'post','private') ON CONFLICT(post_id) DO UPDATE SET visibility='private'").run(post.id);
assert.equal((await publicWorker(new Request(url(replacements[0])),env,{})).status,404);

assert.throws(()=>nativeMediaReplacementSql([]),/INVALID/);
assert.throws(()=>nativeMediaReplacementSql([...replacements,replacements[0]]),/INVALID/);
for(const mutation of [
  r=>{r[0].post_id='legacy-1';},
  r=>{r[0].replacement.object_key=r[0].expected.object_key;},
  r=>{r[0].replacement.bytes=r[0].expected.bytes;},
  r=>{r[0].replacement.object_key="media/native/injected'; DELETE FROM native_posts; --.jpg";},
]){const invalid=structuredClone(replacements);mutation(invalid);assert.throws(()=>nativeMediaReplacementSql(invalid),/INVALID/);}
console.log(JSON.stringify({suite:'native-media-replacement',status:'PASS',behavior:'single-statement whole-group CAS, unchanged published and working snapshots, same public URL new object and MIME, privacy preserved, stale replay rejected'}));
