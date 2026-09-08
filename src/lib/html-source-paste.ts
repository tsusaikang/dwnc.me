import { load } from 'cheerio';
import { sanitizeNativeHtml } from './native-content.ts';

// Deliberately require a recognizable HTML block at the start. Comparisons,
// fenced examples, prose containing tags, and generic type syntax stay text.
export function isHtmlSourcePaste(value: string): boolean {
  const text = value.trim();
  if (!text || text.length > 1_000_000 || !/^(?:<!doctype\s+html\s*>\s*)?<([a-z][a-z0-9-]*)\b[^>]*>/iu.test(text)) return false;
  const known = /<(?:html|body|font|center|details|summary|sub|sup|del|caption|colgroup|col|tfoot|aside|form|textarea|p|div|section|article|main|header|footer|h[1-6]|ul|ol|li|table|thead|tbody|tr|td|th|blockquote|pre|code|span|strong|em|b|i|u|s|a|figure|figcaption|br|hr|img)\b[^>]*>/iu;
  if (!known.test(text)) return false;
  return /<\/([a-z][a-z0-9-]*)\s*>\s*$/iu.test(text) || /^(?:<(?:br|hr|img)\b[^>]*>\s*)+$/iu.test(text);
}

// Kept as literal browser source: bundler keepNames helpers must not leak into
// emitted inline JavaScript through Function.toString().
export const htmlPasteDetectorScript = String.raw`
function isHtmlSourcePaste(value){const text=value.trim();if(!text||text.length>1000000||!/^(?:<!doctype\s+html\s*>\s*)?<([a-z][a-z0-9-]*)\b[^>]*>/i.test(text))return false;if(!/<(?:html|body|font|center|details|summary|sub|sup|del|caption|colgroup|col|tfoot|aside|form|textarea|p|div|section|article|main|header|footer|h[1-6]|ul|ol|li|table|thead|tbody|tr|td|th|blockquote|pre|code|span|strong|em|b|i|u|s|a|figure|figcaption|br|hr|img)\b[^>]*>/i.test(text))return false;return /<\/([a-z][a-z0-9-]*)\s*>\s*$/i.test(text)||/^(?:<(?:br|hr|img)\b[^>]*>\s*)+$/i.test(text)}
`;

export function prepareHtmlSourcePaste(value: unknown) {
  if (typeof value !== 'string' || !isHtmlSourcePaste(value)) throw new Error('ADMIN_E_HTML_PASTE');
  // Server parsing never requests resources. No source image is inserted into
  // the live editor; actual clipboard image files use the existing upload flow.
  const $ = load(value);
  let omitted = /<head\b/iu.test(value) || $('script,style,img,video,audio,source,iframe,object,embed').length > 0;
  $('script,style,head,img,video,audio,source,iframe,object,embed').remove();
  $('textarea,option').each((_index,node) => { $(node).replaceWith($('<span>').text($(node).text())); });
  const body = $('body').html() ?? '';
  const html = sanitizeNativeHtml(body);
  omitted ||= html !== body;
  return { html, omitted };
}
