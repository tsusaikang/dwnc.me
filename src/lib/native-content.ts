import { taxonomyNodeById } from './taxonomy.ts';
import sanitizeHtml from 'sanitize-html';

export const NATIVE_POST_ID_PATTERN = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;
export const NATIVE_MEDIA_PATH_PATTERN = /^\/media\/native\/[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}\.(?:avif|gif|jpe?g|png|webp)$/u;

const TITLE_LIMIT = 180;
const DESCRIPTION_LIMIT = 320;
const BODY_LIMIT = 1_000_000;
const TAG_LIMIT = 30;
const TAG_LENGTH_LIMIT = 60;

export interface NativePostInput {
  title: string;
  description: string;
  bodyMarkdown: string;
  categoryId: string;
  tags: string[];
  coverMediaId: string | null;
}

export interface NormalizedNativePostInput extends NativePostInput {
  categorySlug: string;
  categoryLabel: string;
  bodyHtml: string;
  bodyText: string;
}

export interface NormalizedLegacyPostInput extends NormalizedNativePostInput {}

function compact(value: string) {
  return value.replace(/[\u200B-\u200D\uFEFF]/gu, '').replace(/\s+/gu, ' ').normalize('NFC').trim();
}

export function escapeHtml(value: string) {
  return value.replace(/[&<>"']/gu, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character] ?? character);
}

function safeHref(value: string, image = false) {
  const candidate = value.normalize('NFC').trim();
  if (image) return NATIVE_MEDIA_PATH_PATTERN.test(candidate) ? candidate : null;
  if (candidate.startsWith('/') && !candidate.startsWith('//') && !candidate.includes('\\')) return candidate;
  try {
    const url = new URL(candidate);
    return ['http:', 'https:', 'mailto:'].includes(url.protocol) ? candidate : null;
  } catch {
    return null;
  }
}

function renderInline(value: string) {
  const tokens: string[] = [];
  const token = (html: string) => {
    const id = `\u0000${tokens.length}\u0000`;
    tokens.push(html);
    return id;
  };
  let output = value.replace(/!\[([^\]]*)\]\(([^\s)]+)\)/gu, (_match, alt: string, href: string) => {
    const safe = safeHref(href, true);
    return safe ? token(`<img src="${escapeHtml(safe)}" alt="${escapeHtml(compact(alt))}" loading="lazy" decoding="async">`) : escapeHtml(_match);
  });
  output = output.replace(/\[([^\]]+)\]\(([^\s)]+)\)/gu, (_match, label: string, href: string) => {
    const safe = safeHref(href);
    if (!safe) return escapeHtml(_match);
    const external = /^https?:/u.test(safe) ? ' target="_blank" rel="noopener noreferrer"' : '';
    return token(`<a href="${escapeHtml(safe)}"${external}>${escapeHtml(label)}</a>`);
  });
  output = escapeHtml(output)
    .replace(/`([^`\n]+)`/gu, '<code>$1</code>')
    .replace(/\*\*([^*\n]+)\*\*/gu, '<strong>$1</strong>')
    .replace(/__([^_\n]+)__/gu, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\n]+)\*/gu, '$1<em>$2</em>')
    .replace(/(^|[^_])_([^_\n]+)_/gu, '$1<em>$2</em>');
  return output.replace(/\u0000(\d+)\u0000/gu, (_match, index: string) => tokens[Number(index)] ?? '');
}

export function renderNativeMarkdown(markdown: string) {
  const lines = markdown.replace(/\r\n?/gu, '\n').split('\n');
  const html: string[] = [];
  let paragraph: string[] = [];
  let list: 'ul' | 'ol' | null = null;
  let code: string[] | null = null;

  const flushParagraph = () => {
    if (!paragraph.length) return;
    html.push(`<p>${paragraph.map(renderInline).join('<br>')}</p>`);
    paragraph = [];
  };
  const closeList = () => {
    if (!list) return;
    html.push(`</${list}>`);
    list = null;
  };

  for (const line of lines) {
    if (line.startsWith('```')) {
      flushParagraph();
      closeList();
      if (code === null) code = [];
      else {
        html.push(`<pre><code>${escapeHtml(code.join('\n'))}</code></pre>`);
        code = null;
      }
      continue;
    }
    if (code !== null) {
      code.push(line);
      continue;
    }
    const heading = line.match(/^(#{1,4})\s+(.+)$/u);
    const unordered = line.match(/^\s*[-*+]\s+(.+)$/u);
    const ordered = line.match(/^\s*\d+[.)]\s+(.+)$/u);
    const quote = line.match(/^>\s?(.*)$/u);
    if (!line.trim()) {
      flushParagraph();
      closeList();
    } else if (heading) {
      flushParagraph();
      closeList();
      const level = heading[1].length + 1;
      html.push(`<h${level}>${renderInline(heading[2])}</h${level}>`);
    } else if (unordered || ordered) {
      flushParagraph();
      const nextList = unordered ? 'ul' : 'ol';
      if (list !== nextList) {
        closeList();
        list = nextList;
        html.push(`<${list}>`);
      }
      html.push(`<li>${renderInline((unordered ?? ordered)![1])}</li>`);
    } else if (quote) {
      flushParagraph();
      closeList();
      html.push(`<blockquote><p>${renderInline(quote[1])}</p></blockquote>`);
    } else {
      closeList();
      paragraph.push(line);
    }
  }
  flushParagraph();
  closeList();
  if (code !== null) html.push(`<pre><code>${escapeHtml(code.join('\n'))}</code></pre>`);
  return html.join('\n');
}

export function nativeImagePaths(markdown: string) {
  const paths: string[] = [];
  for (const match of renderNativeMarkdown(markdown).matchAll(/<img src="([^"]+)"[^>]*>/gu)) {
    if (NATIVE_MEDIA_PATH_PATTERN.test(match[1])) paths.push(match[1]);
  }
  return [...new Set(paths)];
}

const LEGACY_TAGS = [
  'a', 'aside', 'b', 'blockquote', 'br', 'code', 'del', 'div', 'figcaption', 'figure',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'i', 'iframe', 'img', 'li', 'ol', 'p',
  'pre', 's', 'span', 'strong', 'table', 'tbody', 'td', 'th', 'tr', 'u', 'ul', 'video',
];
const LEGACY_ATTRIBUTES = [
  'alt', 'aria-hidden', 'aria-label', 'aria-labelledby', 'class', 'data-*', 'height', 'id',
  'loading', 'role', 'style', 'tabindex', 'title', 'width',
];

export function sanitizeLegacyHtml(value: string) {
  return sanitizeHtml(value.normalize('NFC'), {
    allowedTags: LEGACY_TAGS,
    allowedAttributes: {
      '*': LEGACY_ATTRIBUTES,
      a: ['href', 'rel', 'target'],
      iframe: ['allowfullscreen', 'height', 'loading', 'referrerpolicy', 'src', 'title', 'width'],
      img: [...LEGACY_ATTRIBUTES, 'decoding', 'src'],
      video: [...LEGACY_ATTRIBUTES, 'autoplay', 'loop', 'muted', 'playsinline', 'poster', 'preload', 'src'],
    },
    allowedSchemes: ['http', 'https', 'mailto'],
    allowedSchemesByTag: { img: ['http', 'https'], iframe: ['https'], video: ['http', 'https'] },
    allowProtocolRelative: false,
    parser: { lowerCaseAttributeNames: true },
  });
}

export function nativeImagePathsInHtml(html: string) {
  const paths: string[] = [];
  for (const match of html.matchAll(/<img\b[^>]*\bsrc=(?:"([^"]+)"|'([^']+)')[^>]*>/giu)) {
    const path = match[1] ?? match[2] ?? '';
    if (NATIVE_MEDIA_PATH_PATTERN.test(path)) paths.push(path);
  }
  return [...new Set(paths)];
}

function normalizeTags(value: unknown) {
  if (!Array.isArray(value)) throw new Error('NATIVE_E_TAGS');
  const tags = value.map((tag) => compact(String(tag))).filter(Boolean);
  if (tags.length > TAG_LIMIT || tags.some((tag) => tag.length > TAG_LENGTH_LIMIT)) throw new Error('NATIVE_E_TAGS');
  return [...new Set(tags)];
}

export function normalizeNativePostInput(value: unknown, { requirePublishable = true } = {}): NormalizedNativePostInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('NATIVE_E_INPUT');
  const input = value as Record<string, unknown>;
  const title = compact(String(input.title ?? ''));
  const description = compact(String(input.description ?? ''));
  const bodyMarkdown = String(input.bodyMarkdown ?? '').replace(/\r\n?/gu, '\n').normalize('NFC');
  const categoryId = compact(String(input.categoryId ?? ''));
  const category = taxonomyNodeById(categoryId);
  const coverMediaId = input.coverMediaId === null || input.coverMediaId === undefined || input.coverMediaId === ''
    ? null : compact(String(input.coverMediaId));
  if ((requirePublishable && (!title || !bodyMarkdown.trim()))
    || title.length > TITLE_LIMIT || description.length > DESCRIPTION_LIMIT
    || bodyMarkdown.length > BODY_LIMIT || !category
    || (coverMediaId !== null && !NATIVE_POST_ID_PATTERN.test(coverMediaId))) {
    throw new Error('NATIVE_E_INPUT');
  }
  return {
    title,
    description,
    bodyMarkdown,
    categoryId,
    categorySlug: category.slug,
    categoryLabel: category.label,
    tags: normalizeTags(input.tags),
    coverMediaId,
    bodyHtml: renderNativeMarkdown(bodyMarkdown),
    bodyText: compact(bodyMarkdown.replace(/!\[[^\]]*\]\([^)]*\)|\[([^\]]+)\]\([^)]*\)|[#>*_`-]/gu, '$1')),
  };
}

export function normalizeLegacyPostInput(value: unknown): NormalizedLegacyPostInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('NATIVE_E_INPUT');
  const input = value as Record<string, unknown>;
  const title = compact(String(input.title ?? ''));
  const description = compact(String(input.description ?? ''));
  const bodyHtml = sanitizeLegacyHtml(String(input.bodyMarkdown ?? ''));
  const categoryId = compact(String(input.categoryId ?? ''));
  const category = taxonomyNodeById(categoryId);
  const coverMediaId = input.coverMediaId === null || input.coverMediaId === undefined || input.coverMediaId === ''
    ? null : compact(String(input.coverMediaId));
  const bodyText = compact(sanitizeHtml(bodyHtml, { allowedTags: [], allowedAttributes: {} }));
  if (!title || !bodyHtml.trim() || title.length > TITLE_LIMIT || description.length > DESCRIPTION_LIMIT
    || bodyHtml.length > BODY_LIMIT || !category
    || (coverMediaId !== null && !NATIVE_POST_ID_PATTERN.test(coverMediaId))) {
    throw new Error('NATIVE_E_INPUT');
  }
  return {
    title,
    description,
    bodyHtml,
    bodyMarkdown: bodyHtml,
    bodyText,
    categoryId,
    categorySlug: category.slug,
    categoryLabel: category.label,
    tags: normalizeTags(input.tags),
    coverMediaId,
  };
}
