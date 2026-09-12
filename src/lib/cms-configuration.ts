import { TAXONOMY, slugifyLabel } from './taxonomy.ts';
import { sanitizeNativeHtml, NATIVE_POST_ID_PATTERN } from './native-content.ts';
import { load } from 'cheerio';

export interface CmsCategory { id: string; slug: string; label: string; parentId: string | null; sortOrder: number }
export const CCL_VALUES = ['none', 'by', 'by-sa', 'by-nd', 'by-nc', 'by-nc-sa', 'by-nc-nd'] as const;
export const SITE_MEDIA_PATH_PATTERN = /^\/media\/site\/[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}\.(?:avif|gif|jpe?g|png|webp)$/u;
export interface CmsTemplate { id: string; name: string; html: string }
export interface CmsSettings { title: string; description: string; author: string; menu: { label: string; path: string }[]; rssCount: number; rssMode: 'summary' | 'full'; paragraphSpacing: boolean; timezone: string; ccl: typeof CCL_VALUES[number]; iconPath: string | null }
export const DEFAULT_CATEGORIES: CmsCategory[] = TAXONOMY.map(({ id, slug, label, parentId, order }) => ({ id, slug, label, parentId, sortOrder: order }));
export const DEFAULT_SETTINGS: CmsSettings = {
  title: 'dwnc.me', description: '자동차와 수영, 생활의 발견과 생각을 기록하는 개인 블로그.', author: '대왕날치', rssCount: 500, rssMode: 'summary', paragraphSpacing: true,
  timezone: 'Asia/Seoul', ccl: 'none', iconPath: null,
  menu: [{label:'최근 기록',path:'/'}, { label: '모든 글', path: '/archive' }, { label: '카테고리', path: '/category' }, { label: '소개', path: '/about' }],
};
const compact = (value: unknown) => String(value ?? '').normalize('NFC').replace(/\s+/gu, ' ').trim();
export function categoryDescendants(id: string, nodes: CmsCategory[]): CmsCategory[] {
  return nodes.filter((node) => node.parentId === id);
}
export function categoryLineage(id: string, nodes: CmsCategory[]): CmsCategory[] {
  const node = nodes.find((item) => item.id === id); if (!node) return [];
  const parent = nodes.find((item) => item.id === node.parentId);
  return parent ? [parent, node] : [node];
}
export class CmsConfigurationStore {
  private readonly db: D1Database;
  constructor(db: D1Database) { this.db = db; }
  async read<T>(key: 'categories' | 'settings', fallback: T): Promise<{ value: T; revision: number }> {
    const row = await this.db.prepare('SELECT value_json, revision FROM cms_configuration WHERE key = ?1').bind(key).first<{ value_json: string; revision: number }>();
    return row ? { value: JSON.parse(row.value_json) as T, revision: row.revision } : { value: structuredClone(fallback), revision: 0 };
  }
  categories() { return this.read('categories', DEFAULT_CATEGORIES); }
  async settings() { const saved = await this.read('settings', DEFAULT_SETTINGS); return { ...saved, value: { ...DEFAULT_SETTINGS, ...saved.value } }; }
  async templates(): Promise<{value: CmsTemplate[]; revision: number}> {
    const row = await this.db.prepare("SELECT value_json, revision FROM cms_templates WHERE key = 'templates'").first<{value_json: string; revision: number}>();
    return row ? {value: JSON.parse(row.value_json), revision: row.revision} : {value: [], revision: 0};
  }
  async saveTemplates(revision: number, raw: unknown) {
    if (!Array.isArray(raw) || raw.length > 30) throw new Error('NATIVE_E_TEMPLATES');
    const ids = new Set<string>(); const names = new Set<string>();
    const value = raw.map((item): CmsTemplate => {
      if (!item || typeof item !== 'object' || typeof item.html !== 'string' || item.html.length > 100_000) throw new Error('NATIVE_E_TEMPLATES');
      const id = compact(item.id), name = compact(item.name);
      if (!NATIVE_POST_ID_PATTERN.test(id) || ids.has(id) || !name || name.length > 80 || names.has(name)) throw new Error('NATIVE_E_TEMPLATES');
      const $ = load(item.html, {}, false);
      // A saved format cannot carry another post's attached files or embeds.
      if ($('img,picture,video,audio,source,iframe,object,embed,svg,canvas').length
        || $('[src],[srcset],[poster],[background]').length
        || $('a[href]').toArray().some((node) => /(?:^|\/)media\//iu.test($(node).attr('href') ?? ''))) throw new Error('NATIVE_E_TEMPLATE_MEDIA');
      const html = sanitizeNativeHtml(item.html);
      if (!load(html, {}, false).text().trim() && !/<(?:hr|table)\b/iu.test(html)) throw new Error('NATIVE_E_TEMPLATES');
      ids.add(id); names.add(name); return {id, name, html};
    });
    return this.save('templates', revision, value);
  }
  private async save<T>(key: 'categories' | 'settings' | 'templates', revision: number, value: T, extraCondition = '', extraBindings: string[] = []) {
    if (!Number.isSafeInteger(revision) || revision < 0) throw new Error('NATIVE_E_REVISION');
    const table = key === 'templates' ? 'cms_templates' : 'cms_configuration';
    const row = await this.db.prepare(`INSERT INTO ${table} (key, value_json, revision, updated_at)
      SELECT ?1, ?2, 1, ?3 WHERE ?4 = 0 ${extraCondition}
      ON CONFLICT(key) DO NOTHING RETURNING revision`).bind(key, JSON.stringify(value), new Date().toISOString(), revision, ...extraBindings);
    // Both create and update return this writer's exact revision; a concurrent
    // request cannot be mistaken for the successful result of this save.
    const update = this.db.prepare(`UPDATE ${table} SET value_json = ?2, revision = revision + 1, updated_at = ?3
      WHERE key = ?1 AND revision = ?4 AND ?4 > 0 ${extraCondition} RETURNING revision`).bind(key, JSON.stringify(value), new Date().toISOString(), revision, ...extraBindings);
    const result = await this.db.batch<{ revision: number }>([row, update]);
    const saved = result[0].results?.[0] ?? result[1].results?.[0];
    if (!saved) throw new Error('NATIVE_E_REVISION');
    return { value, revision: saved.revision };
  }
  async saveCategories(revision: number, input: unknown) {
    const current = await this.categories();
    if (current.revision !== revision) throw new Error('NATIVE_E_REVISION');
    if (!Array.isArray(input) || !input.length || input.length > 100) throw new Error('NATIVE_E_CATEGORIES');
    const seen = new Set<string>(); const slugs = new Set<string>();
    const value = input.map((raw): CmsCategory => {
      if (!raw || typeof raw !== 'object') throw new Error('NATIVE_E_CATEGORIES');
      const item = raw as Record<string, unknown>; const id = compact(item.id); const old = current.value.find((node) => node.id === id);
      const label = compact(item.label); const parentId = item.parentId ? compact(item.parentId) : null;
      if ((!old && !/^new-[a-f0-9-]{36}$/u.test(id)) || seen.has(id) || !label || label.length > 60
        || !Number.isSafeInteger(item.sortOrder) || Number(item.sortOrder) < 0 || Number(item.sortOrder) > 10000
        || (old && item.slug !== undefined && item.slug !== old.slug)) throw new Error('NATIVE_E_CATEGORIES');
      seen.add(id); let slug = old?.slug ?? slugifyLabel(label);
      if (!old && (current.value.some((node) => node.slug === slug) || slugs.has(slug))) slug += `--${id.slice(4)}`;
      if (slugs.has(slug)) throw new Error('NATIVE_E_CATEGORIES'); slugs.add(slug);
      return { id, label, slug, parentId, sortOrder: Number(item.sortOrder) };
    });
    for (const node of value) {
      if (node.parentId && (!value.some((parent) => parent.id === node.parentId && parent.parentId === null) || node.parentId === node.id)) throw new Error('NATIVE_E_CATEGORIES');
      if (value.some((other) => other.id !== node.id && other.parentId === node.parentId && other.label === node.label)) throw new Error('NATIVE_E_CATEGORIES');
    }
    value.sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id));
    const removed = current.value.filter((node) => !seen.has(node.id));
    for (const node of removed) {
      const count = await this.db.prepare(`SELECT COUNT(*) AS count FROM (
        SELECT category_id FROM native_posts UNION ALL SELECT category_id FROM legacy_posts UNION ALL SELECT category_id FROM editor_working_copies
      ) WHERE category_id = ?1`).bind(node.id).first<{ count: number }>();
      if (count?.count) throw new Error('NATIVE_E_CATEGORY_IN_USE');
    }
    // The same deletion check is part of the CAS, preventing a concurrent post
    // save from assigning a category between validation and removal.
    const condition = removed.map((_, index) => `AND NOT EXISTS (SELECT 1 FROM native_posts WHERE category_id = ?${index + 5}
      UNION ALL SELECT 1 FROM legacy_posts WHERE category_id = ?${index + 5}
      UNION ALL SELECT 1 FROM editor_working_copies WHERE category_id = ?${index + 5})`).join(' ');
    return this.save('categories', revision, value, condition, removed.map((node) => node.id));
  }
  async saveSettings(revision: number, raw: unknown) {
    if (!raw || typeof raw !== 'object') throw new Error('NATIVE_E_SETTINGS');
    const input = raw as Record<string, unknown>;
    const title = compact(input.title), description = compact(input.description), author = compact(input.author);
    if (!title || title.length > 80 || description.length > 320 || !author || author.length > 80 || !Array.isArray(input.menu) || input.menu.length > 8) throw new Error('NATIVE_E_SETTINGS');
    const menu = input.menu.map((raw) => {
      const item = raw as Record<string, unknown>; const label = compact(item?.label); const path = compact(item?.path);
      let decoded = ''; try { decoded = decodeURIComponent(path); } catch {}
      if (!label || label.length > 30 || !/^\/(?:archive|category|tags|about|category\/[^/?#\\]+|tag\/[^/?#\\]+|posts\/[1-9]\d*|pages\/[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12})?$/u.test(decoded)
        || /[<>\u0000-\u001f]/u.test(decoded) || decoded.includes('..')) throw new Error('NATIVE_E_SETTINGS');
      return { label, path };
    });
    const previous = (await this.settings()).value;
    const rssCount = Number(input.rssCount ?? previous.rssCount), rssMode = input.rssMode ?? previous.rssMode, paragraphSpacing = input.paragraphSpacing ?? previous.paragraphSpacing;
    if (!Number.isSafeInteger(rssCount) || rssCount < 1 || rssCount > 500 || (rssMode === 'full' && rssCount > 20) || !['summary','full'].includes(String(rssMode)) || typeof paragraphSpacing !== 'boolean') throw new Error('NATIVE_E_SETTINGS');
    const timezone = input.timezone === undefined ? previous.timezone : compact(input.timezone);
    try { if (!timezone || timezone.length > 100 || !/^[A-Za-z_+-]+(?:\/[A-Za-z0-9_+-]+)*$/u.test(timezone)) throw new Error(); new Intl.DateTimeFormat('en', {timeZone: timezone}); } catch { throw new Error('NATIVE_E_SETTINGS'); }
    const ccl = input.ccl === undefined ? previous.ccl : input.ccl;
    if (!CCL_VALUES.includes(ccl as typeof CCL_VALUES[number])) throw new Error('NATIVE_E_SETTINGS');
    const iconPath = input.iconPath === undefined ? previous.iconPath : input.iconPath;
    if (iconPath !== null && (typeof iconPath !== 'string' || !SITE_MEDIA_PATH_PATTERN.test(iconPath)
      || !await this.db.prepare('SELECT id FROM cms_media WHERE public_path = ?1').bind(iconPath).first())) throw new Error('NATIVE_E_ICON');
    return this.save('settings', revision, { title, description, author, menu, rssCount, rssMode: rssMode as 'summary' | 'full', paragraphSpacing, timezone, ccl: ccl as CmsSettings['ccl'], iconPath: iconPath as string | null });
  }
}
