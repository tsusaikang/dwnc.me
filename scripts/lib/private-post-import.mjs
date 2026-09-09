// Private source data stays in memory. Callers must never log these return values.
import { readFile, lstat, realpath } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { load } from 'cheerio';
import { parse } from 'yaml';
import { sanitizeLegacyHtml } from '../../src/lib/native-content.ts';
import { resolvePostCategory } from '../../src/lib/taxonomy.ts';
import { validateLedger } from './global-sequence.mjs';

const sha = value => createHash('sha256').update(value).digest('hex');
const TYPES = new Map([['image/png','png'],['image/jpeg','jpg'],['image/gif','gif'],['image/webp','webp'],['image/avif','avif'],['image/svg+xml','svg'],['image/x-icon','ico'],['video/mp4','mp4']]);
const fail = code => { throw Object.assign(new Error(code), {safeCode:code}); };
const cssUrls = style => [...style.matchAll(/url\s*\(\s*(['"]?)(.*?)\1\s*\)/giu)].map(match=>match[2]);
const text = html => load(html).root().text().replace(/\s+/gu,' ').trim();
const iso = value => { const d=new Date(value); if(!Number.isFinite(d.getTime()))fail('PRIVATE_IMPORT_E_DATE'); return d.toISOString(); };

async function secureRead(filename, boundary) {
  const full=path.resolve(filename), root=path.resolve(boundary);
  if(!full.startsWith(root+path.sep))fail('PRIVATE_IMPORT_E_PATH');
  // Reject symlinks at every component, including the private root itself.
  for(let p=full;;p=path.dirname(p)){const stat=await lstat(p);if(stat.isSymbolicLink())fail('PRIVATE_IMPORT_E_PATH');if(p===root)break;if(p===path.dirname(p))fail('PRIVATE_IMPORT_E_PATH');}
  if(!(await lstat(full)).isFile() || await realpath(full)!==full)fail('PRIVATE_IMPORT_E_PATH');
  return readFile(full);
}
export function privateMediaIdentity(sourceId, localPath, digest, mime) {
  const extension=TYPES.get(mime);if(!extension||!/^\d+$/u.test(sourceId)||!/^[a-f0-9]{64}$/u.test(digest))fail('PRIVATE_IMPORT_E_MEDIA');
  const bytes=createHash('sha256').update(JSON.stringify(['dwnc-private-import-v1',sourceId,localPath,digest])).digest().subarray(0,16);
  bytes[6]=(bytes[6]&15)|64;bytes[8]=(bytes[8]&63)|128;
  const h=bytes.toString('hex'),id=`${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;
  return {id,publicPath:`/media/native/${id}.${extension}`,objectKey:`media/native/${id}.${extension}`};
}
function splitDocument(raw) {
  if(!raw.startsWith('---\n'))fail('PRIVATE_IMPORT_E_DOCUMENT');const end=raw.indexOf('\n---\n',4);if(end<0)fail('PRIVATE_IMPORT_E_DOCUMENT');
  return {data:parse(raw.slice(4,end)),html:raw.slice(end+5).trim()};
}

export async function loadPrivatePosts(root, {expectedCount=247, verifyLedger=true}={}) {
  try {
    const boundary=path.resolve(root,'migration/private');
    const ledger=JSON.parse(await secureRead(path.join(boundary,'sequence/global-sequence-v1.json'),boundary));
    if(verifyLedger)validateLedger(ledger);
    const entries=ledger.entries.filter(x=>x.source==='naver'&&x.visibility==='private'&&x.status==='active');
    if(entries.length!==expectedCount||new Set(entries.map(x=>x.globalSequence)).size!==expectedCount||new Set(entries.map(x=>x.sourceId)).size!==expectedCount)fail('PRIVATE_IMPORT_E_COUNT');
    const publicProjection=JSON.parse(await readFile(path.join(root,'src/data/public-sequence-v1.json'),'utf8'));
    if(entries.some(e=>publicProjection.some(p=>p.globalSequence===e.globalSequence||p.source==='naver'&&String(p.sourceId)===String(e.sourceId))))fail('PRIVATE_IMPORT_E_PUBLIC_COLLISION');
    const posts=[];
    for(const entry of entries){
      if(!/^\d+$/u.test(entry.sourceId)||!Number.isSafeInteger(entry.globalSequence)||entry.globalSequence<1||entry.globalSequence>596)fail('PRIVATE_IMPORT_E_IDENTITY');
      const base=path.join(boundary,'naver',entry.sourceId),documentPath=path.join(base,'normalized/post.md');
      const manifest=JSON.parse(await secureRead(path.join(base,'migration.json'),boundary));
      const {data,html}=splitDocument((await secureRead(documentPath,boundary)).toString('utf8'));
      if(data.visibility!=='private'||data.source!=='naver'||String(data.sourceId)!==entry.sourceId||!['private','비공개'].includes(manifest.visibility)||String(manifest.source_id)!==entry.sourceId)fail('PRIVATE_IMPORT_E_IDENTITY');
      if(iso(data.publishedAt)!==iso(entry.publishedAt))fail('PRIVATE_IMPORT_E_DATE');
      // The manifest hashes the inner normalized body; retain the importer wrapper.
      const $=load(html,null,false);const wrapper=$('div.naver-content').first();
      const inner=html.replace(/^<div class="naver-content[^"]*">\n/u,'').replace(/\n<\/div>$/u,'');
      if(!wrapper.length||sha(inner)!==manifest.normalized_body_sha256)fail('PRIVATE_IMPORT_E_BODY_HASH');
      const id=`legacy-${entry.globalSequence}`,media=[],byReference=new Map();
      const candidates=[...(manifest.images??[]),...(manifest.videos??[])];
      const refs=new Set(data.cover?[data.cover]:[]);
      $('[src],[poster]').each((_i,node)=>{for(const attr of ['src','poster']){const ref=$(node).attr(attr);if(ref&&!/^https?:\/\//iu.test(ref))refs.add(ref);}});
      $('[style]').each((_i,node)=>{for(const ref of cssUrls($(node).attr('style')??''))refs.add(ref);});
      for(const ref of refs){
        const asset=candidates.find(x=>x.local_path===ref&&x.status==='downloaded');
        if(!asset||!TYPES.has(asset.mime)||!Number.isSafeInteger(asset.size)||asset.size<1)fail('PRIVATE_IMPORT_E_MEDIA');
        const localPath=path.resolve(path.dirname(documentPath),ref);
        if(!localPath.startsWith(path.join(base,'media')+path.sep))fail('PRIVATE_IMPORT_E_PATH');
        const bytes=await secureRead(localPath,boundary);
        if(bytes.length!==asset.size||sha(bytes)!==asset.sha256)fail('PRIVATE_IMPORT_E_MEDIA_HASH');
        const identity=privateMediaIdentity(entry.sourceId,ref,asset.sha256,asset.mime);
        const image=$('img').filter((_i,node)=>$(node).attr('src')===ref).first();
        media.push({...identity,postId:id,sha256:asset.sha256,bytes:bytes.length,mime:asset.mime,localPath,alt:image.attr('alt')??'',createdAt:iso(data.publishedAt)});
        byReference.set(ref,identity.publicPath);
      }
      $('[src],[poster]').each((_i,node)=>{for(const attr of ['src','poster']){const ref=$(node).attr(attr);if(!ref)continue;if(byReference.has(ref))$(node).attr(attr,byReference.get(ref));else if(node.tagName!=='iframe')fail('PRIVATE_IMPORT_E_EXTERNAL_RESOURCE');}});
      $('[style]').each((_i,node)=>{const style=$(node).attr('style')??'';$(node).attr('style',style.replace(/url\s*\(\s*(['"]?)(.*?)\1\s*\)/giu,(_match,_quote,ref)=>{const target=byReference.get(ref);if(!target)fail('PRIVATE_IMPORT_E_EXTERNAL_RESOURCE');return 'url('+target+')';}));});
      let externalFrames=0;
      $('iframe').each((_i,node)=>{const src=$(node).attr('src');if(!src||!/^https:\/\//iu.test(src))fail('PRIVATE_IMPORT_E_EXTERNAL_RESOURCE');const label=$(node).attr('title')||'원본 동영상 열기';const a=$('<a></a>').attr({href:src,target:'_blank',rel:'noopener noreferrer'}).text(label);$(node).replaceWith(a);externalFrames++;});
      const before=$.html(),bodyHtml=sanitizeLegacyHtml(before);
      if(text(before)!==text(bodyHtml))fail('PRIVATE_IMPORT_E_TEXT_LOSS');
      const after=load(bodyHtml,null,false);const finalRefs=new Set();after('[src],[poster]').each((_i,node)=>{for(const a of ['src','poster']){const v=after(node).attr(a);if(v)finalRefs.add(v);}});
      after('[style]').each((_i,node)=>{for(const ref of cssUrls(after(node).attr('style')??''))finalRefs.add(ref);});
      const coverPath=data.cover?byReference.get(data.cover):null;
      if(media.some(m=>m.publicPath!==coverPath&&!finalRefs.has(m.publicPath)))fail('PRIVATE_IMPORT_E_MEDIA_LOSS');
      let category;try{category=resolvePostCategory({data});}catch{category={id:'private-import',slug:'private-import',label:data.categories?.at(-1)||'미분류'};}
      const publishedAt=iso(data.publishedAt);
      posts.push({id,globalSequence:entry.globalSequence,source:'naver',sourceId:entry.sourceId,sourceUrl:data.sourceUrl??null,legacyPath:`/naver/${entry.sourceId}`,title:data.title,description:data.description??'',bodyHtml,bodyText:text(bodyHtml),categoryId:category.id,categorySlug:category.slug,categoryLabel:category.label,tags:data.tags??[],legacyCategories:data.categories??[],coverPath,coverAlt:data.coverAlt??'',coverMediaId:media.find(m=>m.publicPath===coverPath)?.id??null,publishedAt,updatedAt:data.updatedAt?iso(data.updatedAt):publishedAt,sourceUpdatedAt:data.updatedAt?iso(data.updatedAt):null,media,externalFrames});
    }
    return posts.sort((a,b)=>a.globalSequence-b.globalSequence);
  } catch(error) { fail(/^PRIVATE_IMPORT_E_[A-Z_]+$/u.test(error.safeCode??'')?error.safeCode:'PRIVATE_IMPORT_E_INPUT'); }
}

// Plain INSERTs intentionally reject existing rows. Execute the entire array in
// ONE atomic D1 batch; never issue separate statements. No working copy is touched.
export function privatePostStatements(post) {
  const columns=['id','global_sequence','status','source','source_id','source_url','legacy_path','title','description','body_html','body_text','category_id','category_slug','category_label','tags_json','legacy_categories_json','cover_path','cover_alt','cover_media_id','revision','created_at','updated_at','published_at','source_updated_at','import_complete'];
  const values=[post.id,post.globalSequence,'published','naver',post.sourceId,post.sourceUrl,post.legacyPath,post.title,post.description,post.bodyHtml,post.bodyText,post.categoryId,post.categorySlug,post.categoryLabel,JSON.stringify(post.tags),JSON.stringify(post.legacyCategories),post.coverPath,post.coverAlt,post.coverMediaId,0,post.publishedAt,post.updatedAt,post.publishedAt,post.sourceUpdatedAt,1];
  const placeholders=values.map((_v,i)=>`?${i+1}`);
  // A collision in native rows or an orphan working copy must abort, not skip.
  placeholders[0]='CASE WHEN EXISTS(SELECT 1 FROM native_posts WHERE id=?1 OR global_sequence=?2) OR EXISTS(SELECT 1 FROM editor_working_copies WHERE post_id=?1) THEN NULL ELSE ?1 END';
  const statements=[{sql:`INSERT INTO legacy_posts (${columns.join(',')}) VALUES (${placeholders.join(',')})`,params:values},
    {sql:"INSERT INTO content_operations(post_id,kind,visibility,scheduled_at,password_salt,password_digest) VALUES(?1,'post','private',NULL,NULL,NULL)",params:[post.id]}];
  for(const m of post.media)statements.push({sql:'INSERT INTO legacy_media(id,post_id,public_path,object_key,sha256,bytes,mime,alt,created_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9)',params:[m.id,post.id,m.publicPath,m.objectKey,m.sha256,m.bytes,m.mime,m.alt,m.createdAt]});
  return statements;
}

export function privateImportSummary(posts) {
  const media=posts.flatMap(p=>p.media);
  return {posts:posts.length,media:media.length,mediaBytes:media.reduce((n,m)=>n+m.bytes,0),maxMediaBytes:Math.max(0,...media.map(m=>m.bytes)),maxPostBodyBytes:Math.max(0,...posts.map(p=>Buffer.byteLength(p.bodyHtml))),images:media.filter(m=>m.mime.startsWith('image/')).length,videos:media.filter(m=>m.mime.startsWith('video/')).length,unmappedCategories:posts.filter(p=>p.categoryId==='private-import').length,externalFrames:posts.reduce((n,p)=>n+p.externalFrames,0)};
}

// Read only the candidate identity. Returned data is private and must remain in
// memory. An exact prior import can be skipped; an edited/conflicting row stops.
export function privatePostInspectionStatements(post) {
  return [
    {sql:'SELECT * FROM legacy_posts WHERE id=?1 OR global_sequence=?2 OR (source=?3 AND source_id=?4) OR legacy_path=?5',params:[post.id,post.globalSequence,'naver',post.sourceId,post.legacyPath]},
    {sql:'SELECT * FROM content_operations WHERE post_id=?1',params:[post.id]},
    {sql:'SELECT * FROM legacy_media WHERE post_id=?1 ORDER BY id',params:[post.id]},
    {sql:'SELECT COUNT(*) AS conflicts FROM native_posts WHERE id=?1 OR global_sequence=?2',params:[post.id,post.globalSequence]},
    {sql:'SELECT COUNT(*) AS working FROM editor_working_copies WHERE post_id=?1',params:[post.id]},
  ];
}
export function classifyPrivatePostSnapshot(post, resultSets) {
  if(!Array.isArray(resultSets)||resultSets.length!==5)fail('PRIVATE_IMPORT_E_REMOTE_SHAPE');
  const [rows,policies,media,natives,working]=resultSets;
  if(natives?.[0]?.conflicts!==0)fail('PRIVATE_IMPORT_E_EXISTING_CONFLICT');
  if(rows.length===0){if(policies.length||media.length||working?.[0]?.working!==0)fail('PRIVATE_IMPORT_E_EXISTING_CONFLICT');return 'new';}
  const insert=privatePostStatements(post)[0];
  const names=insert.sql.match(/legacy_posts \(([^)]+)\)/u)?.[1].split(',');
  const expected=Object.fromEntries(names.map((name,i)=>[name,insert.params[i]]));
  if(rows.length!==1||Object.entries(expected).some(([key,value])=>rows[0][key]!==value))fail('PRIVATE_IMPORT_E_EXISTING_CONFLICT');
  if(policies.length!==1||policies[0].post_id!==post.id||policies[0].kind!=='post'||policies[0].visibility!=='private'||['scheduled_at','password_salt','password_digest'].some(key=>policies[0][key]!==null))fail('PRIVATE_IMPORT_E_EXISTING_CONFLICT');
  const expectedMedia=post.media.map(m=>({id:m.id,post_id:post.id,public_path:m.publicPath,object_key:m.objectKey,sha256:m.sha256,bytes:m.bytes,mime:m.mime,alt:m.alt,created_at:m.createdAt}));
  const byId=new Map(media.map(m=>[m.id,m]));
  if(media.length!==expectedMedia.length||expectedMedia.some(m=>!byId.has(m.id)||Object.entries(m).some(([key,value])=>byId.get(m.id)[key]!==value)))fail('PRIVATE_IMPORT_E_EXISTING_CONFLICT');
  return 'exact';
}

export async function readPrivateMedia(media, root) {
  try {
    const bytes=await secureRead(media.localPath,path.resolve(root,'migration/private'));
    if(bytes.length!==media.bytes||sha(bytes)!==media.sha256)fail('PRIVATE_IMPORT_E_MEDIA_HASH');
    return bytes;
  } catch(error) { fail(/^PRIVATE_IMPORT_E_[A-Z_]+$/u.test(error.safeCode??'')?error.safeCode:'PRIVATE_IMPORT_E_INPUT'); }
}
