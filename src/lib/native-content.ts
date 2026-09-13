import { IMAGE_LAYOUT_CLASSES } from './image-layout.ts';
import { taxonomyNodeById } from './taxonomy.ts';
import type { CmsCategory } from './cms-configuration.ts';
import sanitizeHtml from 'sanitize-html';

export const NATIVE_POST_ID_PATTERN = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;
export const NATIVE_MEDIA_PATH_PATTERN = /^\/media\/native\/[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}\.(?:avif|gif|jpe?g|png|webp)$/u;
// Imported originals may contain vector images and videos; new uploads retain
// the narrower raster-image contract above.
export const IMPORTED_MEDIA_PATH_PATTERN = /^\/media\/native\/[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}\.(?:svg|ico|mp4)$/u;

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
  coverPath?: string | null;
  coverAlt?: string;
  bodyFormat?: 'markdown' | 'html';
}

export interface NormalizedNativePostInput extends NativePostInput {
  bodyFormat: 'markdown' | 'html';
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
  'a', 'aside', 'b', 'blockquote', 'br', 'caption', 'code', 'col', 'colgroup', 'del', 'div', 'em', 'figcaption', 'figure', 'font',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'i', 'iframe', 'img', 'li', 'ol', 'p',
  'pre', 'details', 'summary', 's', 'span', 'strong', 'sub', 'sup', 'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'tr', 'u', 'ul', 'video',
];
const LEGACY_ATTRIBUTES = [
  'alt', 'aria-hidden', 'aria-label', 'aria-labelledby', 'class', 'data-*', 'height', 'id',
  'loading', 'role', 'style', 'tabindex', 'title', 'width', 'align',
];

const TABLE_LIST_ATTRIBUTES = {
  ol: ['start', 'reversed', 'type'], li: ['value'], ul: ['type'],
  table: ['border', 'cellpadding', 'cellspacing', 'summary'],
  td: ['colspan', 'rowspan', 'headers', 'valign', 'bgcolor'],
  th: ['colspan', 'rowspan', 'headers', 'scope', 'valign', 'bgcolor'],
  col: ['span'], colgroup: ['span'], font: ['color', 'size', 'face'],
};

export function sanitizeLegacyHtml(value: string) {
  return sanitizeHtml(value.normalize('NFC'), {
    allowedTags: LEGACY_TAGS,
    allowedAttributes: {
      ...TABLE_LIST_ATTRIBUTES,
      '*': LEGACY_ATTRIBUTES,
      a: ['href', 'rel', 'target'],
      iframe: ['allowfullscreen', 'height', 'loading', 'referrerpolicy', 'src', 'title', 'width'],
      img: [...LEGACY_ATTRIBUTES, 'decoding', 'src'],
      video: [...LEGACY_ATTRIBUTES, 'autoplay', 'loop', 'muted', 'playsinline', 'poster', 'preload', 'src', 'controls'],
    },
    allowedSchemes: ['http', 'https', 'mailto'],
    allowedSchemesByTag: { img: ['http', 'https'], iframe: ['https'], video: ['http', 'https'] },
    allowProtocolRelative: false,
    parser: { lowerCaseAttributeNames: true },
  });
}

// New rich text has no imported platform embeds or layout CSS to preserve.
// Accept the editor's visible formatting, without script handlers or CSS URLs.
const COLOR_STYLE = /^(?:#[\da-f]{3,8}|[a-z]+|(?:rgba?|hsla?)\([\d\s.,%/+\-]+\))(?:\s*!important)?$/iu;
const SIZE_STYLE = /^(?:\d{1,3}(?:\.\d+)?(?:px|pt|em|rem|%)|xx-small|x-small|small|medium|large|x-large|xx-large)(?:\s*!important)?$/iu;
export function sanitizeNativeHtml(value: string) {
  return sanitizeHtml(value.normalize('NFC'), {
    allowedTags: LEGACY_TAGS.filter((tag) => !['aside', 'iframe', 'video'].includes(tag)),
    allowedAttributes: {
      ...TABLE_LIST_ATTRIBUTES,
      '*': ['style', 'align', 'title', 'lang', 'dir', 'class', 'data-dwnc-original-width', 'data-dwnc-original-max-width', 'data-dwnc-original-height'],
      span: ['data-dwnc-no-autolink'],
      a: ['href', 'rel', 'target'],
      img: ['src', 'alt', 'width', 'height', 'loading', 'decoding', 'style'],
      figure: ['class', 'data-ke-type', 'style'],
    },
    allowedClasses: { figure: ['imageblock', 'alignLeft', 'alignCenter', 'alignRight'], a: ['og-image'], div: ['og-image', 'og-text', ...IMAGE_LAYOUT_CLASSES], p: ['og-title', 'og-desc', 'og-host'], span: ['og-image', 'og-text', 'og-title', 'og-desc', 'og-host'] },
    allowedStyles: {
      '*': {
        '--dwnc-original-layout-width': [/^\d{1,4}px$/u],
        color: [COLOR_STYLE], 'background-color': [COLOR_STYLE],
        'font-size': [SIZE_STYLE],
        'font-family': [/^(?:system-ui|sans-serif|serif|monospace|Arial|Georgia|['"]?나눔고딕['"]?|['"]?나눔명조['"]?)(?:\s*,\s*(?:sans-serif|serif|monospace))?(?:\s*!important)?$/iu],
        'font-weight': [/^(?:normal|bold|bolder|lighter|[1-9]00)(?:\s*!important)?$/iu],
        'font-style': [/^(?:normal|italic|oblique)(?:\s*!important)?$/iu],
        'text-decoration': [/^(?:none|underline|line-through|overline)(?:\s+(?:underline|line-through|overline))*(?:\s*!important)?$/iu],
        'text-decoration-line': [/^(?:none|underline|line-through|overline)(?:\s+(?:underline|line-through|overline))*(?:\s*!important)?$/iu],
        'text-align': [/^(?:left|center|right|justify|start|end)(?:\s*!important)?$/iu],
        'vertical-align': [/^(?:top|middle|bottom|baseline|sub|super)$/iu],
        width: [SIZE_STYLE, /^\d{1,6}px(?:\s*!important)?$/iu, /^auto(?:\s*!important)?$/iu], height: [SIZE_STYLE], 'max-width': [SIZE_STYLE],
        'margin-left': [/^(?:auto|0(?:px)?)(?:\s*!important)?$/iu], 'margin-right': [/^(?:auto|0(?:px)?)(?:\s*!important)?$/iu],
      },
    },
    allowedSchemes: ['http', 'https', 'mailto'],
    allowProtocolRelative: false,
    transformTags: {
      img: (_tagName, attribs) => ({ tagName: 'img', attribs: {
        ...attribs, src: safeHref(attribs.src ?? '', true) ?? '', loading: 'lazy', decoding: 'async',
      } }),
      a: (_tagName, attribs) => ({ tagName: 'a', attribs: {
        ...attribs, href: safeHref(attribs.href ?? '') ?? '',
        ...(attribs.target === '_blank' ? { rel: 'noopener noreferrer' } : {}),
      } }),
    },
    exclusiveFilter: (frame) => frame.tag === 'img' && !frame.attribs.src,
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

export function normalizeNativePostInput(value: unknown, { requirePublishable = true, categories }: { requirePublishable?: boolean; categories?: CmsCategory[] } = {}): NormalizedNativePostInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('NATIVE_E_INPUT');
  const input = value as Record<string, unknown>;
  const title = compact(String(input.title ?? ''));
  const description = compact(String(input.description ?? ''));
  const bodyMarkdown = String(input.bodyMarkdown ?? '').replace(/\r\n?/gu, '\n').normalize('NFC');
  const categoryId = compact(String(input.categoryId ?? ''));
  const category = categories ? categories.find((node) => node.id === categoryId) : taxonomyNodeById(categoryId);
  const coverMediaId = input.coverMediaId === null || input.coverMediaId === undefined || input.coverMediaId === ''
    ? null : compact(String(input.coverMediaId));
  if ((requirePublishable && (!title || !bodyMarkdown.trim()))
    || title.length > TITLE_LIMIT || description.length > DESCRIPTION_LIMIT
    || bodyMarkdown.length > BODY_LIMIT || !category
    || (coverMediaId !== null && !NATIVE_POST_ID_PATTERN.test(coverMediaId))) {
    throw new Error('NATIVE_E_INPUT');
  }
  return {
    bodyFormat: 'markdown',
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

function normalizeHtmlPostInput(value: unknown, { requirePublishable = true, legacy = false, categories }: { requirePublishable?: boolean; legacy?: boolean; categories?: CmsCategory[] } = {}): NormalizedLegacyPostInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('NATIVE_E_INPUT');
  const input = value as Record<string, unknown>;
  const title = compact(String(input.title ?? ''));
  const description = compact(String(input.description ?? ''));
  const rawHtml = String(input.bodyMarkdown ?? '');
  if (rawHtml.length > BODY_LIMIT) throw new Error('NATIVE_E_INPUT');
  const bodyHtml = legacy ? sanitizeLegacyHtml(rawHtml) : sanitizeNativeHtml(rawHtml);
  const categoryId = compact(String(input.categoryId ?? ''));
  const category = categories ? categories.find((node) => node.id === categoryId) : taxonomyNodeById(categoryId);
  const coverMediaId = input.coverMediaId === null || input.coverMediaId === undefined || input.coverMediaId === ''
    ? null : compact(String(input.coverMediaId));
  const bodyText = compact(sanitizeHtml(bodyHtml, { allowedTags: [], allowedAttributes: {} }));
  const nativeContentPresent = Boolean(bodyText.replace(/&(?:nbsp|#160|#x0*a0);/giu, ' ').trim())
    || nativeImagePathsInHtml(bodyHtml).length > 0;
  if ((requirePublishable && (!title || !bodyHtml.trim() || (!legacy && !nativeContentPresent)))
    || title.length > TITLE_LIMIT || description.length > DESCRIPTION_LIMIT
    || bodyHtml.length > BODY_LIMIT || !category
    || (coverMediaId !== null && !NATIVE_POST_ID_PATTERN.test(coverMediaId))) {
    throw new Error('NATIVE_E_INPUT');
  }
  return {
    bodyFormat: 'html',
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

export function normalizeLegacyPostInput(value: unknown, options: { requirePublishable?: boolean; categories?: CmsCategory[] } = {}) {
  return normalizeHtmlPostInput(value, { ...options, legacy: true });
}

export function normalizeEditorPostInput(value: unknown,
  current: { bodyFormat: 'markdown' | 'html'; sourceKind: 'native' | 'legacy' },
  options: { requirePublishable?: boolean; categories?: CmsCategory[] } = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('NATIVE_E_INPUT');
  const format = (value as Record<string, unknown>).bodyFormat ?? current.bodyFormat;
  if ((format !== 'markdown' && format !== 'html') || (current.sourceKind === 'legacy' && format !== 'html')) {
    throw new Error('NATIVE_E_INPUT');
  }
  return format === 'html'
    ? normalizeHtmlPostInput(value, { ...options, legacy: current.sourceKind === 'legacy' })
    : normalizeNativePostInput(value, options);
}
