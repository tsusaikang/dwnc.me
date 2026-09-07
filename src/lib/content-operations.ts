export type ContentKind = 'post' | 'page' | 'notice';
export type Visibility = 'public' | 'private' | 'scheduled' | 'protected';
export interface ContentOperation { kind: ContentKind; visibility: Visibility; scheduledAt: string | null }
interface StoredOperation { post_id: string; kind: ContentKind; visibility: Visibility; scheduled_at: string | null; password_salt: string | null; password_digest: string | null }
const hex = (bytes: ArrayBuffer) => [...new Uint8Array(bytes)].map(byte=>byte.toString(16).padStart(2,'0')).join('');
const unhex = (value: string) => Uint8Array.from(value.match(/../gu) ?? [], part=>parseInt(part,16));
export async function digest(value: string) { return hex(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))); }
async function passwordHash(password: string, salt: string) {
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(password),'PBKDF2',false,['deriveBits']);
 return hex(await crypto.subtle.deriveBits({name:'PBKDF2',salt:unhex(salt),iterations:100000,hash:'SHA-256'},key,256));
}
export function contentKind(value: unknown): ContentKind {
 if (!['post','page','notice'].includes(String(value))) throw new Error('NATIVE_E_KIND');
 return value as ContentKind;
}
export class ContentOperations {
 private db: D1Database; private now: ()=>Date;
 constructor(db: D1Database, now: ()=>Date = ()=>new Date()) {this.db=db;this.now=now;}
 async all() { const rows=await this.db.prepare('SELECT * FROM content_operations').all<StoredOperation>();return new Map((rows.results??[]).map(row=>[row.post_id,row])); }
 async get(id: string) { return this.db.prepare('SELECT * FROM content_operations WHERE post_id=?1').bind(id).first<StoredOperation>(); }
 publicValue(row: StoredOperation | null | undefined): ContentOperation { return {kind:row?.kind??'post',visibility:row?.visibility??'public',scheduledAt:row?.scheduled_at??null}; }
 visible(row: StoredOperation | null | undefined) { return !row || row.visibility==='public' || (row.visibility==='scheduled' && !!row.scheduled_at && row.scheduled_at<=this.now().toISOString()); }
 async preparePublish(id: string, input: Record<string,unknown>) {
  const old=await this.get(id), visibility=String(input.visibility??old?.visibility??'public');
  if(!['public','private','scheduled','protected'].includes(visibility)) throw new Error('NATIVE_E_VISIBILITY');
  let at: string|null=null, salt: string|null=null, hash: string|null=null;
  if(visibility==='scheduled') { if(typeof input.scheduledAt!=='string'||!/^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/u.test(input.scheduledAt)||!Number.isFinite(Date.parse(input.scheduledAt))||Date.parse(input.scheduledAt)<=this.now().getTime())throw new Error('NATIVE_E_SCHEDULE');at=new Date(input.scheduledAt).toISOString(); }
  if(visibility==='protected') {
   if(input.password===undefined||input.password==='') {salt=old?.password_salt??null;hash=old?.password_digest??null;if(!salt||!hash)throw new Error('NATIVE_E_PASSWORD');}
   else {if(typeof input.password!=='string'||input.password.length<8||input.password.length>128)throw new Error('NATIVE_E_PASSWORD');salt=hex(crypto.getRandomValues(new Uint8Array(16)).buffer);hash=await passwordHash(input.password,salt);}
  }
  return {visibility,at,salt,hash};
 }
 async authorized(id: string, request: Request, protectedOnly = false, expectedRevision?: number) {
  const row=await this.get(id);if(!protectedOnly&&this.visible(row))return true;if(row?.visibility!=='protected')return false;
  if(expectedRevision!==undefined){const revision=await this.db.prepare(`SELECT revision FROM native_posts WHERE id=?1 UNION ALL SELECT revision FROM legacy_posts WHERE id=?1 AND import_complete=1`).bind(id).first<{revision:number}>();if(revision?.revision!==expectedRevision)return false;}
  const name=`dwnc_access_${id.replaceAll('-','')}`;
  const token=(request.headers.get('cookie')??'').split(';').map(part=>part.trim()).find(part=>part.startsWith(`${name}=`))?.slice(name.length+1);
  if(!token||!/^[-a-f0-9]{64}$/u.test(token))return false;
  const session=await this.db.prepare('SELECT 1 AS valid FROM protected_sessions WHERE post_id=?1 AND token_digest=?2 AND expires_at>?3').bind(id,await digest(token),this.now().toISOString()).first();return !!session;
 }
 async unlock(id: string, password: string, request: Request) {
  const row=await this.get(id);if(row?.visibility!=='protected'||!row.password_salt||!row.password_digest||password.length>128)return null;
  const now=this.now().getTime(), key=await digest(`${id}:${request.headers.get('cf-connecting-ip')??'local'}`);
  const attempt=await this.db.prepare(`INSERT INTO protected_attempts(attempt_key,window_start,count) VALUES(?1,?2,1)
   ON CONFLICT(attempt_key) DO UPDATE SET window_start=CASE WHEN window_start<?2-900000 THEN ?2 ELSE window_start END,
   count=CASE WHEN window_start<?2-900000 THEN 1 ELSE count+1 END RETURNING count`).bind(key,now).first<{count:number}>();
  if(!attempt||attempt.count>10)return null;
  const candidate=await passwordHash(password,row.password_salt);let difference=0;for(let i=0;i<candidate.length;i++)difference|=candidate.charCodeAt(i)^row.password_digest.charCodeAt(i);if(difference)return null;
  const token=hex(crypto.getRandomValues(new Uint8Array(32)).buffer),expires=new Date(now+3600000).toISOString();
  const created=await this.db.batch([this.db.prepare('DELETE FROM protected_sessions WHERE expires_at<=?1').bind(this.now().toISOString()),this.db.prepare(`INSERT INTO protected_sessions(token_digest,post_id,expires_at) SELECT ?1,?2,?3 WHERE EXISTS(SELECT 1 FROM content_operations WHERE post_id=?2 AND visibility='protected' AND password_salt=?4 AND password_digest=?5) RETURNING post_id`).bind(await digest(token),id,expires,row.password_salt,row.password_digest)]);
  if(!created[1].results?.length)return null;
  return `dwnc_access_${id.replaceAll('-','')}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=3600`;
 }
}

export async function boundedBody(request: Request, limit: number): Promise<Uint8Array> {
 if(Number(request.headers.get('content-length')??0)>limit)throw new Error('ADMIN_E_BODY_SIZE');
 if(!request.body)return new Uint8Array();
 const reader=request.body.getReader(),chunks:Uint8Array[]=[];let length=0;
 try {while(true){const {done,value}=await reader.read();if(done)break;length+=value.byteLength;if(length>limit){await reader.cancel();throw new Error('ADMIN_E_BODY_SIZE');}chunks.push(value);}}
 finally{reader.releaseLock();}
 const result=new Uint8Array(length);let offset=0;for(const chunk of chunks){result.set(chunk,offset);offset+=chunk.byteLength;}return result;
}
