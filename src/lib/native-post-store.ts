import { ContentOperations, contentKind, type ContentKind, type Visibility } from './content-operations.ts';
import {
  nativeImagePathsInHtml, normalizeEditorPostInput, normalizeNativePostInput,
  type NormalizedNativePostInput,
} from './native-content.ts';
import { CmsConfigurationStore } from './cms-configuration.ts';
import { load } from 'cheerio';
import mediaManifest from '../data/public-media-r2-v1.json' with { type: 'json' };
import { slugifyLabel } from './taxonomy.ts';

export type NativePostStatus = 'draft' | 'published' | 'tombstone';

export interface NativePost {
  kind?: ContentKind; visibility?: Visibility; scheduledAt?: string | null; publicPath?: string | null;
  id: string;
  globalSequence: number | null;
  status: NativePostStatus;
  title: string;
  description: string;
  bodyMarkdown: string;
  bodyHtml: string;
  bodyText: string;
  categoryId: string;
  categorySlug: string;
  categoryLabel: string;
  tags: string[];
  coverMediaId: string | null;
  coverPath: string | null;
  coverAlt: string;
  source?: 'naver' | 'tistory';
  sourceId?: string;
  revision: number;
  publishedRevision: number | null;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
  bodyFormat: 'markdown' | 'html';
  sourceKind: 'native' | 'legacy';
}

export interface AdminPostSummary {
  kind?: ContentKind; visibility?: Visibility; scheduledAt?: string | null; publicPath?: string | null;
  categoryId: string; categoryLabel: string; tags: string[]; publishedAt: string | null;
  hasUnpublishedChanges: boolean; coverPath: string | null;
  id: string;
  globalSequence: number | null;
  status: NativePostStatus;
  title: string;
  updatedAt: string;
  bodyFormat: 'markdown' | 'html';
  sourceKind: 'native' | 'legacy';
}

export interface NativeMedia {
  id: string;
  postId: string;
  publicPath: string;
  objectKey: string;
  sha256: string;
  bytes: number;
  mime: string;
  alt: string;
  createdAt: string;
}

interface NativePostRow {
  operation_kind?: ContentKind; operation_visibility?: Visibility; operation_scheduled_at?: string | null;
  id: string;
  global_sequence: number | null;
  status: NativePostStatus;
  title: string;
  description: string;
  body_markdown: string;
  body_html: string;
  body_text: string;
  category_id: string;
  category_slug: string;
  category_label: string;
  tags_json: string;
  cover_media_id: string | null;
  cover_path?: string | null; cover_alt?: string | null; source?: 'naver' | 'tistory'; source_id?: string;
  revision: number;
  published_revision?: number | null;
  created_at: string;
  updated_at: string;
  published_at: string | null;
  body_format?: 'markdown' | 'html';
  source_kind: 'native' | 'legacy';
}

interface NativeMediaRow {
  id: string;
  post_id: string;
  public_path: string;
  object_key: string;
  sha256: string;
  bytes: number;
  mime: string;
  alt: string;
  created_at: string;
}

const POST_COLUMNS = `id, global_sequence, status, title, description, body_markdown, body_html,
  body_text, category_id, category_slug, category_label, tags_json, cover_media_id, cover_path, cover_alt, NULL AS source, NULL AS source_id,
  revision, created_at, updated_at, published_at, body_format, 'native' AS source_kind`;
const LEGACY_POST_COLUMNS = `id, global_sequence, status, title, description,
  body_html AS body_markdown, body_html, body_text, category_id, category_slug, category_label,
  tags_json, cover_media_id, cover_path, cover_alt, source, source_id, revision, created_at, updated_at, published_at,
  'html' AS body_format, 'legacy' AS source_kind`;

const policyColumns = (table: string) => `COALESCE((SELECT kind FROM content_operations WHERE post_id=${table}.id),'post') AS operation_kind,
 COALESCE((SELECT visibility FROM content_operations WHERE post_id=${table}.id),'public') AS operation_visibility,
 (SELECT scheduled_at FROM content_operations WHERE post_id=${table}.id) AS operation_scheduled_at`;
const publicCondition = (table: string) => `NOT EXISTS(SELECT 1 FROM content_operations WHERE post_id=${table}.id AND visibility!='public' AND NOT(visibility='scheduled' AND scheduled_at<=?1))`;
function policyPost(row: NativePostRow): NativePost {
 const post=postFromRow(row), kind=row.operation_kind??'post', visibility=row.operation_visibility??'public', scheduledAt=row.operation_scheduled_at??null;
 return {...post,kind,visibility,scheduledAt,publishedAt:visibility==='scheduled'&&scheduledAt?scheduledAt:post.publishedAt,publicPath:post.globalSequence===null?null:kind==='page'?`/pages/${post.id}`:`/posts/${post.globalSequence}`};
}
export function snapshotVisible(post: Pick<NativePost,'visibility'|'scheduledAt'>, now: Date = new Date()) {
 return !post.visibility||post.visibility==='public'||post.visibility==='scheduled'&&!!post.scheduledAt&&post.scheduledAt<=now.toISOString();
}
const WORKING_FIELDS = ['title', 'description', 'body_markdown', 'body_html', 'body_text',
  'category_id', 'category_slug', 'category_label', 'tags_json', 'cover_media_id', 'cover_path', 'cover_alt'] as const;
const ADMIN_POST_SOURCE = `(SELECT ${POST_COLUMNS} FROM native_posts
  UNION ALL SELECT ${LEGACY_POST_COLUMNS} FROM legacy_posts WHERE import_complete = 1)`;
const ADMIN_POST_COLUMNS = `p.id, p.global_sequence, p.status,
  ${WORKING_FIELDS.map((field) => `CASE WHEN w.post_id IS NULL${field === 'cover_path' || field === 'cover_alt' ? ' OR w.cover_selection_set IS NULL' : ''} THEN p.${field} ELSE w.${field} END AS ${field}`).join(', ')},
  COALESCE(w.revision, p.revision) AS revision, p.created_at,
  COALESCE(w.updated_at, p.updated_at) AS updated_at, p.published_at, p.source, p.source_id,
  COALESCE(w.body_format, p.body_format) AS body_format, p.source_kind,
  CASE WHEN w.post_id IS NULL THEN CASE WHEN p.status = 'published' THEN p.revision ELSE NULL END
    ELSE w.published_revision END AS published_revision`;

function parseTags(value: string) {
  let tags: unknown;
  try { tags = JSON.parse(value); } catch { throw new Error('NATIVE_E_STORED_POST'); }
  if (!Array.isArray(tags) || tags.some((tag) => typeof tag !== 'string')) throw new Error('NATIVE_E_STORED_POST');
  return tags;
}

function postFromRow(row: NativePostRow): NativePost {
  if (!row || !['draft', 'published', 'tombstone'].includes(row.status)
    || !Number.isSafeInteger(row.revision) || row.revision < 0
    || !['markdown', 'html'].includes(row.body_format ?? 'markdown')
    || !['native', 'legacy'].includes(row.source_kind)
    || (row.global_sequence !== null && (!Number.isSafeInteger(row.global_sequence) || row.global_sequence < 1))) {
    throw new Error('NATIVE_E_STORED_POST');
  }
  return {
    id: row.id,
    globalSequence: row.global_sequence,
    status: row.status,
    title: row.title,
    description: row.description,
    bodyMarkdown: row.body_markdown,
    bodyHtml: row.body_html,
    bodyText: row.body_text,
    categoryId: row.category_id,
    categorySlug: row.category_slug,
    categoryLabel: row.category_label,
    tags: parseTags(row.tags_json),
    coverMediaId: row.cover_media_id, coverPath: row.cover_path ?? null, coverAlt: row.cover_alt ?? '',
    ...(row.source ? { source: row.source, sourceId: row.source_id } : {}),
    revision: row.revision,
    publishedRevision: row.published_revision === undefined
      ? (row.status === 'published' ? row.revision : null) : row.published_revision,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    publishedAt: row.published_at,
    bodyFormat: row.body_format ?? 'markdown',
    sourceKind: row.source_kind,
  };
}

function mediaFromRow(row: NativeMediaRow): NativeMedia {
  return {
    id: row.id,
    postId: row.post_id,
    publicPath: row.public_path,
    objectKey: row.object_key,
    sha256: row.sha256,
    bytes: row.bytes,
    mime: row.mime,
    alt: row.alt,
    createdAt: row.created_at,
  };
}

function nowIso(now: () => Date) {
  return now().toISOString();
}

export class NativePostStore {
  private readonly database: D1Database;
  private readonly now: () => Date;

  constructor(database: D1Database, now: () => Date = () => new Date()) {
    this.database = database;
    this.now = now;
  }

  async createDraft(category: { id: string; slug: string; label: string }, kind: unknown = 'post'): Promise<NativePost> {
    kind = contentKind(kind);
    const id = crypto.randomUUID();
    const now = nowIso(this.now);
    const insert = this.database.prepare(`INSERT INTO native_posts (
      id, status, title, description, body_markdown, body_html, body_text,
      category_id, category_slug, category_label, tags_json, revision, created_at, updated_at
    ) SELECT ?1, 'draft', '', '', '', '', '', ?2, ?3, ?4, '[]', 0, ?5, ?5
      WHERE NOT EXISTS (SELECT 1 FROM cms_configuration WHERE key='categories') OR EXISTS (SELECT 1 FROM cms_configuration, json_each(value_json) c WHERE cms_configuration.key='categories' AND json_extract(c.value,'$.id') = ?2)
    RETURNING ${POST_COLUMNS}`).bind(id, category.id, category.slug, category.label, now);
    const created = await this.database.batch<NativePostRow>([insert,this.database.prepare('INSERT INTO content_operations(post_id,kind) SELECT ?1,?2 WHERE changes()=1').bind(id,kind)]);
    const row = created[0].results?.[0];
    if (!row) throw new Error('NATIVE_E_CREATE');
    return this.decorate(postFromRow(row));
  }

  async decorate(post: NativePost): Promise<NativePost> {
    const ops = new ContentOperations(this.database, this.now);
    const operation = ops.publicValue(await ops.get(post.id));
    return {...post,...operation,publishedAt:operation.visibility==='scheduled'&&operation.scheduledAt?operation.scheduledAt:post.publishedAt,publicPath:post.globalSequence===null?null:operation.kind==='page'?`/pages/${post.id}`:`/posts/${post.globalSequence}`};
  }

  async getForAdmin(id: string): Promise<NativePost | null> {
    const row = await this.adminPostStatement(id).first<NativePostRow>();
    return row ? this.decorate(postFromRow(row)) : null;
  }

  private adminPostStatement(id: string) {
    return this.database.prepare(`SELECT ${ADMIN_POST_COLUMNS} FROM ${ADMIN_POST_SOURCE} p
      LEFT JOIN editor_working_copies w ON w.post_id = p.id WHERE p.id = ?1`).bind(id);
  }

  private initializeWorkingCopy(id: string) {
    return this.database.prepare(`INSERT INTO editor_working_copies
      (post_id, ${WORKING_FIELDS.join(', ')}, body_format, revision, published_revision, updated_at)
      SELECT id, ${WORKING_FIELDS.join(', ')}, body_format, revision,
        CASE WHEN status = 'published' THEN revision ELSE NULL END, updated_at
      FROM ${ADMIN_POST_SOURCE} WHERE id = ?1 AND status != 'tombstone'
      ON CONFLICT(post_id) DO NOTHING`).bind(id);
  }

  async listForAdmin(): Promise<AdminPostSummary[]> {
    const posts = await this.database.prepare(`SELECT p.id, p.global_sequence, p.status,
      COALESCE(w.title, p.title) AS title, COALESCE(w.updated_at, p.updated_at) AS updated_at,
      COALESCE(w.body_format, p.body_format) AS body_format, p.source_kind,
      COALESCE(w.category_id,p.category_id) AS category_id, COALESCE(w.category_label,p.category_label) AS category_label,
      COALESCE(w.tags_json,p.tags_json) AS tags_json, p.published_at,
      COALESCE(w.revision,p.revision) AS revision,
      CASE WHEN w.post_id IS NULL THEN CASE WHEN p.status='published' THEN p.revision END ELSE w.published_revision END AS published_revision,
      CASE WHEN w.cover_selection_set IS NULL THEN p.cover_path ELSE w.cover_path END AS cover_path
      FROM ${ADMIN_POST_SOURCE} p LEFT JOIN editor_working_copies w ON w.post_id = p.id
      WHERE p.status != 'tombstone' ORDER BY updated_at DESC, global_sequence DESC, p.id`).all<NativePostRow>();
    const categories = (await new CmsConfigurationStore(this.database).categories()).value;
    const operations = new ContentOperations(this.database, this.now); const policies = await operations.all();
    return (posts.results ?? []).map((row) => ({
      ...operations.publicValue(policies.get(row.id)), publicPath: row.global_sequence === null ? null : policies.get(row.id)?.kind === 'page' ? `/pages/${row.id}` : `/posts/${row.global_sequence}`,
      id: row.id, globalSequence: row.global_sequence, status: row.status, title: row.title,
      updatedAt: row.updated_at, bodyFormat: row.body_format ?? 'markdown', sourceKind: row.source_kind,
      categoryId: row.category_id, categoryLabel: categories.find((node) => node.id === row.category_id)?.label ?? row.category_label,
      tags: parseTags(row.tags_json), publishedAt: row.published_at, coverPath: row.cover_path ?? null,
      hasUnpublishedChanges: row.published_revision == null || row.revision !== row.published_revision,
    }));
  }

  async searchAdminBodyIds(query: string) {
    const result = await this.database.prepare(`SELECT p.id FROM (
      SELECT id, body_text FROM native_posts WHERE status != 'tombstone'
      UNION ALL SELECT id, body_text FROM legacy_posts WHERE import_complete = 1
    ) p LEFT JOIN editor_working_copies w ON w.post_id = p.id
      WHERE instr(lower(COALESCE(w.body_text,p.body_text)), ?1) > 0`).bind(query).all<{id:string}>();
    return new Set((result.results ?? []).map((row)=>row.id));
  }

  async mediaForPost(id: string) {
    const post = await this.getForAdmin(id); if (!post) throw new Error('NATIVE_E_MEDIA_POST');
    const media = await this.database.prepare(`SELECT id, public_path, alt FROM ${post.sourceKind === 'legacy' ? 'legacy_media' : 'native_media'} WHERE post_id = ?1 ORDER BY created_at`).bind(id).all<{id:string;public_path:string;alt:string}>();
    const images = new Map<string, {id: string | null; path: string; alt: string; kind: 'native' | 'legacy'}>();
    for (const item of media.results ?? []) images.set(item.public_path, {id:item.id,path:item.public_path,alt:item.alt,kind:'native'});
    const allowed = new Set(mediaManifest.entries.filter((entry) => entry.contentType.startsWith('image/')).map((entry) => entry.publicPath));
    const $ = load(post.bodyHtml);
    $('img[src]').each((_i, image) => { const path = $(image).attr('src') ?? ''; if (allowed.has(path)) images.set(path, {id:null,path,alt:$(image).attr('alt') ?? '',kind:'legacy'}); });
    if (post.coverPath && allowed.has(post.coverPath)) images.set(post.coverPath,{id:null,path:post.coverPath,alt:post.coverAlt,kind:'legacy'});
    return [...images.values()];
  }

  async normalizeInput(value: unknown, current: NativePost, requirePublishable = false) {
    const categories = (await new CmsConfigurationStore(this.database).categories()).value;
    return normalizeEditorPostInput(value, current, { requirePublishable, categories });
  }

  async update(id: string, revision: number, value: unknown): Promise<NativePost> {
    if (!Number.isSafeInteger(revision) || revision < 0) throw new Error('NATIVE_E_REVISION');
    const current = await this.getForAdmin(id);
    if (!current || current.revision !== revision || current.status === 'tombstone') throw new Error('NATIVE_E_REVISION');
    const input = await this.normalizeInput(value, current);
    const raw = value as Record<string, unknown>;
    const kind = contentKind(raw.kind ?? current.kind ?? 'post');
    if (kind !== current.kind && current.globalSequence !== null) throw new Error('NATIVE_E_KIND_LOCKED');
    let coverPath = raw.coverPath === undefined ? current.coverPath : (raw.coverPath ? String(raw.coverPath) : null);
    const coverAlt = raw.coverAlt === undefined ? current.coverAlt : String(raw.coverAlt).slice(0, 300);
    const media = await this.mediaForPost(id);
    if (raw.coverPath === undefined && input.coverMediaId) coverPath = media.find((item) => item.id === input.coverMediaId)?.path ?? coverPath;
    const cover = coverPath ? media.find((item) => item.path === coverPath) : null;
    if (coverPath && coverPath !== current.coverPath && !cover) throw new Error('NATIVE_E_COVER');
    input.coverMediaId = cover?.id ?? (coverPath === current.coverPath ? current.coverMediaId : null);
    const now = nowIso(this.now);
    // The result is read inside the write transaction so a later writer's
    // revision can never be acknowledged as this client's successful save.
    const results = await this.database.batch<NativePostRow>([
      this.initializeWorkingCopy(id),
      this.database.prepare(`UPDATE editor_working_copies SET
        title = ?1, description = ?2, body_markdown = ?3, body_html = ?4, body_text = ?5,
        category_id = ?6, category_slug = ?7, category_label = ?8, tags_json = ?9,
        cover_media_id = ?10, revision = revision + 1, updated_at = ?11, body_format = ?14, cover_path = ?15, cover_alt = ?16, cover_selection_set = 1
        WHERE post_id = ?12 AND revision = ?13
          AND (NOT EXISTS (SELECT 1 FROM cms_configuration WHERE key='categories') OR EXISTS (SELECT 1 FROM cms_configuration, json_each(value_json) c WHERE cms_configuration.key='categories' AND json_extract(c.value,'$.id') = ?6))
          AND EXISTS (SELECT 1 FROM ${ADMIN_POST_SOURCE} WHERE id = ?12 AND status != 'tombstone')
        RETURNING revision`).bind(
        input.title, input.description, input.bodyMarkdown, input.bodyHtml, input.bodyText,
        input.categoryId, input.categorySlug, input.categoryLabel, JSON.stringify(input.tags),
        input.coverMediaId, now, id, revision, input.bodyFormat, coverPath, coverAlt,
      ),
      this.database.prepare(`INSERT INTO content_operations(post_id,kind) SELECT ?1,?2 WHERE changes()=1
        ON CONFLICT(post_id) DO UPDATE SET kind=excluded.kind`).bind(id,kind),
      this.adminPostStatement(id),
    ]);
    if (!results[1]?.results?.length || !results[3]?.results?.[0]) throw new Error('NATIVE_E_REVISION');
    return this.decorate(postFromRow(results[3].results[0]));
  }

  async publish(id: string, revision: number, options: Record<string,unknown> = {}): Promise<NativePost> {
    if (!Number.isSafeInteger(revision) || revision < 0) throw new Error('NATIVE_E_REVISION');
    const current = await this.getForAdmin(id);
    if (!current || current.revision !== revision || current.status === 'tombstone') throw new Error('NATIVE_E_REVISION');
    await this.normalizeInput(current, current, true);
    const policy = await new ContentOperations(this.database,this.now).preparePublish(id,options);
    const now = nowIso(this.now);
    const legacy = current.sourceKind === 'legacy';
    const fields = legacy ? WORKING_FIELDS.filter((field) => field !== 'body_markdown')
      : [...WORKING_FIELDS, 'body_format'];
    const statements = [this.initializeWorkingCopy(id)];
    if (!legacy) {
      statements.push(this.database.prepare(`INSERT INTO native_sequence_claims (post_id, claimed_at)
        SELECT ?1, ?2 WHERE EXISTS (
          SELECT 1 FROM native_posts p JOIN editor_working_copies w ON w.post_id = p.id
          WHERE p.id = ?1 AND p.status = 'draft' AND w.revision = ?3)
        ON CONFLICT(post_id) DO NOTHING`).bind(id, now, revision));
    }
    // D1 batch is transactional. changes() ties the public snapshot write to
    // this exact CAS, even when another tab saved or published first.
    statements.push(
      this.database.prepare(`UPDATE editor_working_copies SET
        revision = revision + 1, published_revision = revision + 1, updated_at = ?1
        WHERE post_id = ?2 AND revision = ?3
          AND EXISTS (SELECT 1 FROM ${ADMIN_POST_SOURCE} WHERE id = ?2 AND status != 'tombstone')
        RETURNING revision`).bind(now, id, revision),
      this.database.prepare(`UPDATE ${legacy ? 'legacy_posts' : 'native_posts'} SET
        (${fields.join(', ')}) = (SELECT ${fields.map((field) => field === 'body_format'
          ? 'COALESCE(body_format, native_posts.body_format)' : (field === 'cover_path' || field === 'cover_alt') ? `CASE WHEN cover_selection_set IS NULL THEN ${legacy ? 'legacy_posts' : 'native_posts'}.${field} ELSE ${field} END` : field).join(', ')} FROM editor_working_copies WHERE post_id = ?1),
        revision = ?3 + 1, updated_at = ?2${legacy ? '' : `,
        global_sequence = COALESCE(global_sequence, (SELECT global_sequence FROM native_sequence_claims WHERE post_id = ?1)),
        status = 'published', published_at = COALESCE(published_at, ?2)`}
        WHERE id = ?1 AND changes() = 1
          AND EXISTS (SELECT 1 FROM editor_working_copies WHERE post_id = ?1 AND revision = ?3 + 1)
          ${legacy ? 'AND import_complete = 1' : "AND status IN ('draft', 'published')"}
        RETURNING ${legacy ? LEGACY_POST_COLUMNS : POST_COLUMNS}`).bind(id, now, revision),
    );
    const publicResultIndex = statements.length - 1;
    statements.push(this.database.prepare(`INSERT INTO content_operations(post_id,kind,visibility,scheduled_at,password_salt,password_digest)
      SELECT ?1,?2,?3,?4,?5,?6 WHERE changes()=1 ON CONFLICT(post_id) DO UPDATE SET visibility=excluded.visibility,scheduled_at=excluded.scheduled_at,password_salt=excluded.password_salt,password_digest=excluded.password_digest`).bind(id,current.kind??'post',policy.visibility,policy.at,policy.salt,policy.hash));
    statements.push(this.database.prepare(`DELETE FROM protected_sessions WHERE post_id=?1 AND changes()=1`).bind(id));
    const results = await this.database.batch<NativePostRow>(statements);
    const row = results[publicResultIndex]?.results?.[0];
    if (!row) throw new Error('NATIVE_E_REVISION');
    return this.decorate(postFromRow(row));
  }

  async deleteEmptyDraft(id: string, revision: number) {
    const current = await this.getForAdmin(id);
    if (!current || current.revision !== revision) throw new Error('NATIVE_E_REVISION');
    const html = load(current.bodyHtml);
    const emptyBody = current.bodyFormat === 'html' ? !html('body').text().trim() && html('body *').toArray().every(node=>['p','br','div','span'].includes(node.tagName)) : !current.bodyMarkdown.trim();
    if (current.sourceKind !== 'native' || current.status !== 'draft' || current.globalSequence !== null || current.title.trim() || !emptyBody || current.description.trim() || current.coverPath || current.tags.length) throw new Error('NATIVE_E_NOT_EMPTY');
    const eligible = `EXISTS(SELECT 1 FROM native_posts p LEFT JOIN editor_working_copies w ON w.post_id=p.id WHERE p.id=?1 AND p.status='draft' AND COALESCE(w.revision,p.revision)=?2 AND NOT EXISTS(SELECT 1 FROM native_media WHERE post_id=?1))`;
    // Atomically remove only an empty new working copy; never remove R2 objects.
    const results=await this.database.batch([
      this.database.prepare(`INSERT INTO content_operations(post_id) SELECT ?1 WHERE ${eligible} ON CONFLICT(post_id) DO NOTHING`).bind(id,revision),
      this.database.prepare(`DELETE FROM editor_working_copies WHERE post_id=?1 AND ${eligible} RETURNING post_id`).bind(id,revision),
      this.database.prepare(`DELETE FROM content_operations WHERE post_id=?1 AND EXISTS(SELECT 1 FROM native_posts WHERE id=?1 AND status='draft') AND (changes()=1 OR (NOT EXISTS(SELECT 1 FROM editor_working_copies WHERE post_id=?1) AND EXISTS(SELECT 1 FROM native_posts WHERE id=?1 AND revision=?2))) AND NOT EXISTS(SELECT 1 FROM native_media WHERE post_id=?1) RETURNING post_id`).bind(id,revision),
      this.database.prepare(`DELETE FROM native_posts WHERE id=?1 AND status='draft' AND changes()=1 RETURNING id`).bind(id),
    ]);
    if(!results[3].results?.length)throw new Error('NATIVE_E_NOT_EMPTY');
    return {deleted:true};
  }

  async managedSequences() {
    const rows=await this.database.prepare(`SELECT global_sequence FROM native_posts WHERE global_sequence IS NOT NULL UNION ALL SELECT global_sequence FROM legacy_posts WHERE import_complete=1`).all<{global_sequence:number}>();
    return new Set((rows.results??[]).map(row=>row.global_sequence));
  }
  async releasedPage(id: string) {
    const row=await this.database.prepare(`SELECT ${POST_COLUMNS}, ${policyColumns('native_posts')} FROM native_posts WHERE id=?1 AND status='published'`).bind(id).first<NativePostRow>();
    if(!row)return null;const post=policyPost(row);return post.kind==='page'?post:null;
  }

  async getPublishedBySequence(sequence: number): Promise<NativePost | null> {
    const post = await this.getReleasedBySequence(sequence);
    return post && snapshotVisible(post,this.now()) ? post : null;
  }

  async getReleasedBySequence(sequence: number): Promise<NativePost | null> {
    const row = await this.database.prepare(`SELECT ${POST_COLUMNS}, ${policyColumns('native_posts')} FROM native_posts
      WHERE global_sequence = ?1 AND status = 'published'`).bind(sequence).first<NativePostRow>();
    if (row) return policyPost(row);
    const legacy = await this.database.prepare(`SELECT ${LEGACY_POST_COLUMNS}, ${policyColumns('legacy_posts')} FROM legacy_posts
      WHERE global_sequence = ?1 AND import_complete = 1`).bind(sequence).first<NativePostRow>();
    return legacy ? policyPost(legacy) : null;
  }

  async listPublished(includeSearchText: boolean | 'full' = 'full'): Promise<NativePost[]> {
    const lite = (columns: string) => includeSearchText === 'full' ? columns : columns.replace('body_html AS body_markdown, body_html, body_text', `'' AS body_markdown, '' AS body_html, ${includeSearchText ? 'body_text' : 'substr(body_text,1,160) AS body_text'}`).replace('body_markdown, body_html,\n  body_text', `'' AS body_markdown, '' AS body_html, ${includeSearchText ? 'body_text' : 'substr(body_text,1,160) AS body_text'}`);
    const native = await this.database.prepare(`SELECT ${lite(POST_COLUMNS)}, ${policyColumns('native_posts')} FROM native_posts
      WHERE status = 'published' AND ${publicCondition('native_posts')} ORDER BY global_sequence DESC`).bind(nowIso(this.now)).all<NativePostRow>();
    const legacy = await this.database.prepare(`SELECT ${lite(LEGACY_POST_COLUMNS)}, ${policyColumns('legacy_posts')} FROM legacy_posts
      WHERE import_complete = 1 AND ${publicCondition('legacy_posts')} ORDER BY global_sequence DESC`).bind(nowIso(this.now)).all<NativePostRow>();
    return [...(native.results ?? []), ...(legacy.results ?? [])].map(policyPost)
      .sort((left, right) => (right.globalSequence ?? 0) - (left.globalSequence ?? 0));
  }

  async listPublishedFor({ categorySlug, tagSlug }: { categorySlug?: string; tagSlug?: string } = {}) {
    const posts = await this.listPublished();
    return posts.filter((post) => (!categorySlug || post.categorySlug === categorySlug)
      && (!tagSlug || post.tags.some((tag) => slugifyLabel(tag) === tagSlug)));
  }

  async addMedia(media: NativeMedia): Promise<NativeMedia> {
    const post = await this.getForAdmin(media.postId);
    if (!post || post.status === 'tombstone') throw new Error('NATIVE_E_MEDIA_POST');
    const legacy = post.sourceKind === 'legacy';
    const table = legacy ? 'legacy_media' : 'native_media';
    const parent = legacy ? 'legacy_posts' : 'native_posts';
    const row = await this.database.prepare(`INSERT INTO ${table} (
      id, post_id, public_path, object_key, sha256, bytes, mime, alt, created_at
    ) SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9
      WHERE EXISTS (SELECT 1 FROM ${parent} WHERE id = ?2${legacy ? ' AND import_complete = 1' : ''})
      RETURNING id, post_id, public_path, object_key, sha256, bytes, mime, alt, created_at`).bind(
      media.id, media.postId, media.publicPath, media.objectKey, media.sha256,
      media.bytes, media.mime, media.alt, media.createdAt,
    ).first<NativeMediaRow>();
    if (!row) throw new Error('NATIVE_E_MEDIA_POST');
    return mediaFromRow(row);
  }

  async getAdminMedia(publicPath: string): Promise<NativeMedia | null> {
    let row = await this.database.prepare(`SELECT m.id, m.post_id, m.public_path, m.object_key,
      m.sha256, m.bytes, m.mime, m.alt, m.created_at
      FROM native_media m JOIN native_posts p ON p.id = m.post_id
      WHERE m.public_path = ?1 AND p.status != 'tombstone'`).bind(publicPath).first<NativeMediaRow>();
    if (!row) {
      row = await this.database.prepare(`SELECT m.id, m.post_id, m.public_path, m.object_key,
        m.sha256, m.bytes, m.mime, m.alt, m.created_at
        FROM legacy_media m JOIN legacy_posts p ON p.id = m.post_id
        WHERE m.public_path = ?1 AND p.import_complete = 1`).bind(publicPath).first<NativeMediaRow>();
    }
    return row ? mediaFromRow(row) : null;
  }

  async getPublicMedia(publicPath: string, request?: Request): Promise<(NativeMedia & { bodyMarkdown: string; coverMediaId: string | null }) | null> {
    let row = await this.database.prepare(`SELECT m.id, m.post_id, m.public_path, m.object_key,
      m.sha256, m.bytes, m.mime, m.alt, m.created_at, p.body_html AS body_markdown, p.cover_media_id, p.revision AS snapshot_revision, ${policyColumns('p')}
      FROM native_media m JOIN native_posts p ON p.id = m.post_id
      WHERE m.public_path = ?1 AND p.status = 'published'`).bind(publicPath).first<NativeMediaRow & {
        body_markdown: string; cover_media_id: string | null; operation_visibility: Visibility; operation_scheduled_at: string|null; snapshot_revision:number;
      }>();
    if (!row) {
      row = await this.database.prepare(`SELECT m.id, m.post_id, m.public_path, m.object_key,
        m.sha256, m.bytes, m.mime, m.alt, m.created_at, p.body_html AS body_markdown, p.cover_media_id, p.revision AS snapshot_revision, ${policyColumns('p')}
        FROM legacy_media m JOIN legacy_posts p ON p.id = m.post_id
        WHERE m.public_path = ?1 AND p.import_complete = 1`).bind(publicPath).first<NativeMediaRow & {
          body_markdown: string; cover_media_id: string | null; operation_visibility: Visibility; operation_scheduled_at: string|null; snapshot_revision:number;
        }>();
    }
    if (row && !snapshotVisible({visibility:row.operation_visibility,scheduledAt:row.operation_scheduled_at},this.now())) {
      if(row.operation_visibility!=='protected'||!request||!await new ContentOperations(this.database,this.now).authorized(row.post_id,request,true,row.snapshot_revision))return null;
    }
    const references = nativeImagePathsInHtml(row?.body_markdown ?? '');
    if (!row || (row.cover_media_id !== row.id && !references.includes(row.public_path))) return null;
    return { ...mediaFromRow(row), bodyMarkdown: row.body_markdown, coverMediaId: row.cover_media_id };
  }
}

export function normalizedInputForPublish(value: unknown): NormalizedNativePostInput {
  return normalizeNativePostInput(value, { requirePublishable: true });
}
