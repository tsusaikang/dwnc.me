import { nativeImagePaths, normalizeNativePostInput, type NormalizedNativePostInput } from './native-content.ts';
import { slugifyLabel } from './taxonomy.ts';

export type NativePostStatus = 'draft' | 'published' | 'tombstone';

export interface NativePost {
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
  revision: number;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
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
  revision: number;
  created_at: string;
  updated_at: string;
  published_at: string | null;
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
  body_text, category_id, category_slug, category_label, tags_json, cover_media_id,
  revision, created_at, updated_at, published_at`;

function parseTags(value: string) {
  let tags: unknown;
  try { tags = JSON.parse(value); } catch { throw new Error('NATIVE_E_STORED_POST'); }
  if (!Array.isArray(tags) || tags.some((tag) => typeof tag !== 'string')) throw new Error('NATIVE_E_STORED_POST');
  return tags;
}

function postFromRow(row: NativePostRow): NativePost {
  if (!row || !['draft', 'published', 'tombstone'].includes(row.status)
    || !Number.isSafeInteger(row.revision) || row.revision < 0
    || (row.global_sequence !== null && (!Number.isSafeInteger(row.global_sequence) || row.global_sequence < 597))) {
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
    coverMediaId: row.cover_media_id,
    revision: row.revision,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    publishedAt: row.published_at,
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

  async createDraft(category: { id: string; slug: string; label: string }): Promise<NativePost> {
    const id = crypto.randomUUID();
    const now = nowIso(this.now);
    const row = await this.database.prepare(`INSERT INTO native_posts (
      id, status, title, description, body_markdown, body_html, body_text,
      category_id, category_slug, category_label, tags_json, revision, created_at, updated_at
    ) VALUES (?1, 'draft', '', '', '', '', '', ?2, ?3, ?4, '[]', 0, ?5, ?5)
    RETURNING ${POST_COLUMNS}`).bind(id, category.id, category.slug, category.label, now).first<NativePostRow>();
    if (!row) throw new Error('NATIVE_E_CREATE');
    return postFromRow(row);
  }

  async getForAdmin(id: string): Promise<NativePost | null> {
    const row = await this.database.prepare(`SELECT ${POST_COLUMNS} FROM native_posts WHERE id = ?1`)
      .bind(id).first<NativePostRow>();
    return row ? postFromRow(row) : null;
  }

  async listForAdmin(): Promise<NativePost[]> {
    const result = await this.database.prepare(`SELECT ${POST_COLUMNS} FROM native_posts
      WHERE status != 'tombstone' ORDER BY updated_at DESC, id ASC`).all<NativePostRow>();
    return (result.results ?? []).map(postFromRow);
  }

  async update(id: string, revision: number, value: unknown): Promise<NativePost> {
    if (!Number.isSafeInteger(revision) || revision < 0) throw new Error('NATIVE_E_REVISION');
    const current = await this.getForAdmin(id);
    if (!current || current.revision !== revision || current.status === 'tombstone') throw new Error('NATIVE_E_REVISION');
    const input = normalizeNativePostInput(value, { requirePublishable: current.status === 'published' });
    const now = nowIso(this.now);
    const row = await this.database.prepare(`UPDATE native_posts SET
      title = ?1, description = ?2, body_markdown = ?3, body_html = ?4, body_text = ?5,
      category_id = ?6, category_slug = ?7, category_label = ?8, tags_json = ?9,
      cover_media_id = ?10, revision = revision + 1, updated_at = ?11
      WHERE id = ?12 AND revision = ?13 AND status IN ('draft', 'published')
      RETURNING ${POST_COLUMNS}`).bind(
      input.title, input.description, input.bodyMarkdown, input.bodyHtml, input.bodyText,
      input.categoryId, input.categorySlug, input.categoryLabel, JSON.stringify(input.tags),
      input.coverMediaId, now, id, revision,
    ).first<NativePostRow>();
    if (!row) throw new Error('NATIVE_E_REVISION');
    return postFromRow(row);
  }

  async publish(id: string, revision: number): Promise<NativePost> {
    if (!Number.isSafeInteger(revision) || revision < 0) throw new Error('NATIVE_E_REVISION');
    const current = await this.getForAdmin(id);
    if (!current || current.revision !== revision || current.status === 'tombstone') throw new Error('NATIVE_E_REVISION');
    normalizeNativePostInput(current, { requirePublishable: true });
    if (current.status === 'published') return current;
    const now = nowIso(this.now);
    const results = await this.database.batch<NativePostRow>([
      this.database.prepare(`INSERT INTO native_sequence_claims (post_id, claimed_at)
        SELECT ?1, ?2 WHERE EXISTS (SELECT 1 FROM native_posts WHERE id = ?1 AND status = 'draft' AND revision = ?3)
        ON CONFLICT(post_id) DO NOTHING`).bind(id, now, revision),
      this.database.prepare(`UPDATE native_posts SET
        global_sequence = (SELECT global_sequence FROM native_sequence_claims WHERE post_id = ?1),
        status = 'published', published_at = ?2, updated_at = ?2, revision = revision + 1
        WHERE id = ?1 AND revision = ?3 AND status = 'draft'
        RETURNING ${POST_COLUMNS}`).bind(id, now, revision),
    ]);
    const row = results[1]?.results?.[0];
    if (!row) throw new Error('NATIVE_E_REVISION');
    return postFromRow(row);
  }

  async getPublishedBySequence(sequence: number): Promise<NativePost | null> {
    const row = await this.database.prepare(`SELECT ${POST_COLUMNS} FROM native_posts
      WHERE global_sequence = ?1 AND status = 'published'`).bind(sequence).first<NativePostRow>();
    return row ? postFromRow(row) : null;
  }

  async listPublished(): Promise<NativePost[]> {
    const result = await this.database.prepare(`SELECT ${POST_COLUMNS} FROM native_posts
      WHERE status = 'published' ORDER BY global_sequence DESC`).all<NativePostRow>();
    return (result.results ?? []).map(postFromRow);
  }

  async listPublishedFor({ categorySlug, tagSlug }: { categorySlug?: string; tagSlug?: string } = {}) {
    const posts = await this.listPublished();
    return posts.filter((post) => (!categorySlug || post.categorySlug === categorySlug)
      && (!tagSlug || post.tags.some((tag) => slugifyLabel(tag) === tagSlug)));
  }

  async addMedia(media: NativeMedia): Promise<NativeMedia> {
    const row = await this.database.prepare(`INSERT INTO native_media (
      id, post_id, public_path, object_key, sha256, bytes, mime, alt, created_at
    ) SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9
      WHERE EXISTS (SELECT 1 FROM native_posts WHERE id = ?2 AND status IN ('draft', 'published'))
      RETURNING id, post_id, public_path, object_key, sha256, bytes, mime, alt, created_at`).bind(
      media.id, media.postId, media.publicPath, media.objectKey, media.sha256,
      media.bytes, media.mime, media.alt, media.createdAt,
    ).first<NativeMediaRow>();
    if (!row) throw new Error('NATIVE_E_MEDIA_POST');
    return mediaFromRow(row);
  }

  async getPublicMedia(publicPath: string): Promise<(NativeMedia & { bodyMarkdown: string; coverMediaId: string | null }) | null> {
    const row = await this.database.prepare(`SELECT m.id, m.post_id, m.public_path, m.object_key,
      m.sha256, m.bytes, m.mime, m.alt, m.created_at, p.body_markdown, p.cover_media_id
      FROM native_media m JOIN native_posts p ON p.id = m.post_id
      WHERE m.public_path = ?1 AND p.status = 'published'`).bind(publicPath).first<NativeMediaRow & {
        body_markdown: string; cover_media_id: string | null;
      }>();
    if (!row || (row.cover_media_id !== row.id && !nativeImagePaths(row.body_markdown).includes(row.public_path))) return null;
    return { ...mediaFromRow(row), bodyMarkdown: row.body_markdown, coverMediaId: row.cover_media_id };
  }
}

export function normalizedInputForPublish(value: unknown): NormalizedNativePostInput {
  return normalizeNativePostInput(value, { requirePublishable: true });
}
