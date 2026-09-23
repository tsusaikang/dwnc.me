// Authorized maintenance only. Credentials stay in a private JSON file or env.
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { R2S3Client } from './lib/r2-s3-client.mjs';
import { nativeMediaReplacementSql } from './lib/native-media-replacement.mjs';
const ACCOUNT='91612366e0a114716988f7cb393b9da5', BUCKET='dwnc-me-native-media-production', DB='852b307f-58e2-42d9-b332-caa7462cb7a9';
const [mode,planFile,credentialFile,extra]=process.argv.slice(2);
if(!['check','upload','apply','verify','download','upload-r2','verify-r2','download-r2','delete-old-r2'].includes(mode)||!planFile) throw new Error('Usage: node scripts/execute-native-media-replacement.mjs check|upload|apply|verify|download|upload-r2|verify-r2|download-r2|delete-old-r2 PRIVATE_PLAN.json [PRIVATE_CREDENTIALS.json] [DOWNLOAD_MEDIA_ID]');
const plan=JSON.parse(await readFile(planFile,'utf8')); const sql=nativeMediaReplacementSql(plan);
const hash=b=>createHash('sha256').update(b).digest('hex');
const credentials=credentialFile?JSON.parse(await readFile(credentialFile,'utf8')):{accessKeyId:process.env.DWNC_R2_ACCESS_KEY_ID,secretAccessKey:process.env.DWNC_R2_SECRET_ACCESS_KEY,apiToken:process.env.DWNC_CF_API_TOKEN};
const client=()=>new R2S3Client({accountId:ACCOUNT,bucket:BUCKET,accessKeyId:credentials.accessKeyId,secretAccessKey:credentials.secretAccessKey,maxAttempts:1,timeoutMilliseconds:60000});
async function query(sql,params=[]){
 if(!credentials.apiToken)throw new Error('D1_TOKEN_REQUIRED');
 const response=await fetch(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/d1/database/${DB}/query`,{method:'POST',headers:{Authorization:`Bearer ${credentials.apiToken}`,'Content-Type':'application/json'},body:JSON.stringify({sql,params}),redirect:'error',signal:AbortSignal.timeout(60000)});
 const result=await response.json();if(!response.ok||!result.success||result.result.some(x=>!x.success))throw new Error(`D1_QUERY_FAILED_${response.status}`);
 return result.result[0].results;
}
async function verifyObject(r2,entry){
 const response=await r2.request({method:'GET',key:entry.replacement.object_key,headers:{'x-amz-checksum-mode':'ENABLED'}});
 if(!response.ok)throw new Error(`R2_READ_FAILED_${response.status}`);
 const bytes=Buffer.from(await response.arrayBuffer()),r=entry.replacement;
 if(bytes.length!==r.bytes||hash(bytes)!==r.sha256||response.headers.get('content-type')!==r.mime||response.headers.get('x-amz-meta-contract')!=='dwnc-native-media-v1'||response.headers.get('x-amz-meta-sha256')!==r.sha256||response.headers.get('x-amz-checksum-sha256')!==Buffer.from(r.sha256,'hex').toString('base64'))throw new Error('R2_CONTENT_OR_METADATA_MISMATCH');
}
async function currentMatches(replacement=false){
 const rows=await query(`SELECT id,post_id,public_path,object_key,sha256,bytes,mime FROM native_media WHERE id IN (${plan.map(()=>'?').join(',')})`,plan.map(x=>x.id));
 if(rows.length!==plan.length)throw new Error('D1_TARGET_COUNT_CHANGED');
 for(const entry of plan){const row=rows.find(x=>x.id===entry.id),expected=replacement?entry.replacement:entry.expected;if(row.post_id!==entry.post_id||row.public_path!==entry.public_path||Object.entries(expected).some(([k,v])=>row[k]!==v))throw new Error('D1_TARGET_CHANGED');}
 return rows;
}
if(mode==='download'||mode==='download-r2'){
 if(!/^[a-f0-9-]{36}$/.test(extra||''))throw new Error('MEDIA_ID_REQUIRED');
 const rows=mode==='download-r2'?JSON.parse(await readFile(path.resolve(path.dirname(planFile),'download-snapshot.json'),'utf8')).filter(x=>x.id===extra):await query('SELECT id,object_key,sha256,bytes,mime FROM native_media WHERE id=?',[extra]);if(rows.length!==1)throw new Error('MEDIA_NOT_FOUND');const row=rows[0];if(!/^media\/native\/[a-f0-9-]{36}\.(jpg|png|webp|avif)$/.test(row.object_key)||!/^[a-f0-9]{64}$/.test(row.sha256)||!Number.isSafeInteger(row.bytes))throw new Error('INVALID_DOWNLOAD_SNAPSHOT');
 const response=await client().request({method:'GET',key:row.object_key});if(!response.ok)throw new Error(`R2_READ_FAILED_${response.status}`);const bytes=Buffer.from(await response.arrayBuffer());if(bytes.length!==row.bytes||hash(bytes)!==row.sha256)throw new Error('SOURCE_MISMATCH');
 const target=path.resolve(path.dirname(planFile),'originals',path.basename(row.object_key));await writeFile(target,bytes,{flag:'wx',mode:0o600});console.log(JSON.stringify({downloaded:row.id,bytes:row.bytes}));
}else {
 const files=[];for(const entry of plan){const bytes=await readFile(path.resolve(path.dirname(planFile),entry.candidateFile));if(bytes.length!==entry.replacement.bytes||hash(bytes)!==entry.replacement.sha256)throw new Error('CANDIDATE_MISMATCH');files.push(bytes);}
 if(mode==='delete-old-r2'){
  // Caller must first confirm zero old-key references in current D1 via the approved console.
  if(extra!=='--d1-old-references-confirmed-zero')throw new Error('D1_REFERENCE_CONFIRMATION_REQUIRED');
  const r2=client(),oldObjects=[];
  for(const entry of plan){
   const original=await readFile(path.resolve(path.dirname(planFile),'originals',path.basename(entry.expected.object_key)));
   if(original.length!==entry.expected.bytes||hash(original)!==entry.expected.sha256)throw new Error('PRESERVED_ORIGINAL_MISMATCH');
   await verifyObject(r2,entry);
   const response=await r2.request({method:'GET',key:entry.expected.object_key});
   if(response.status===404){oldObjects.push({entry,alreadyGone:true});continue;}
   if(!response.ok)throw new Error(`OLD_R2_READ_FAILED_${response.status}`);
   const bytes=Buffer.from(await response.arrayBuffer()),etag=response.headers.get('etag');
   if(bytes.length!==entry.expected.bytes||hash(bytes)!==entry.expected.sha256||!etag)throw new Error('OLD_R2_OBJECT_CHANGED');
   oldObjects.push({entry,etag});
  }
  let deleted=0;
  for(const {entry,etag,alreadyGone} of oldObjects){
   if(!alreadyGone){const response=await r2.request({method:'DELETE',key:entry.expected.object_key,headers:{'if-match':etag}});if(!response.ok)throw new Error(`OLD_R2_DELETE_FAILED_${response.status}`);await response.body?.cancel();deleted++;}
   const head=await r2.request({method:'HEAD',key:entry.expected.object_key});if(head.status!==404)throw new Error('OLD_R2_DELETE_NOT_CONFIRMED');await head.body?.cancel();
  }
  console.log(JSON.stringify({deleted,alreadyGone:oldObjects.length-deleted,oldObjectsAbsent:oldObjects.length,originalsPreserved:true}));
 }
 if(mode==='check'){console.log(JSON.stringify({prepared:plan.length,productionWrites:0}));}
 if(mode==='upload'||mode==='upload-r2'){
  if(mode==='upload')await currentMatches();const r2=client();
  for(const [i,entry] of plan.entries()){
   const r=entry.replacement,response=await r2.request({method:'PUT',key:r.object_key,payloadSha256:r.sha256,body:files[i],headers:{'content-type':r.mime,'if-none-match':'*','x-amz-checksum-sha256':Buffer.from(r.sha256,'hex').toString('base64'),'x-amz-meta-contract':'dwnc-native-media-v1','x-amz-meta-sha256':r.sha256}});
   // A previous interrupted run is accepted only after exact content/metadata verification.
   if(!response.ok&&response.status!==412)throw new Error(`R2_CREATE_FAILED_${response.status}`);await response.body?.cancel();await verifyObject(r2,entry);console.log(JSON.stringify({uploadedOrAlreadyExact:entry.id}));
  }
 }
 if(mode==='apply'){
  await currentMatches();const r2=client();for(const entry of plan)await verifyObject(r2,entry);
  const changed=await query(sql);if(changed.length!==plan.length)throw new Error('D1_CAS_NOT_APPLIED');await currentMatches(true);console.log(JSON.stringify({updated:changed.length,postContentChanged:false}));
 }
 if(mode==='verify'||mode==='verify-r2'){
  if(mode==='verify')await currentMatches(true);const r2=client();for(const entry of plan)await verifyObject(r2,entry);
  console.log(JSON.stringify({verified:plan.length,oldObjectsDeleted:0}));
 }
}
