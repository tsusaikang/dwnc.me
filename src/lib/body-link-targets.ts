import { load } from 'cheerio';

interface BodyLinkOptions {
  baseUrl?: string;
  // The preview is hosted on the administrator's origin. Resolve only its
  // relative web destinations against the public article, without saving them.
  absoluteRelativeLinks?: boolean;
}

// Final body presentation only: call after URL/card/imported transformations.
// The editor, stored snapshots and surrounding site navigation never enter here.
export function prepareBodyLinkTargets(html: string, options: BodyLinkOptions = {}): string {
  const $ = load(html, null, false);
  let changed = false;
  for (const element of $('a[href]').toArray()) {
    const anchor = $(element), href = anchor.attr('href') ?? '', trimmed = href.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    let destination: URL;
    try { destination = new URL(trimmed, options.baseUrl ?? 'https://dwnc.me/'); } catch { continue; }
    if (!['http:', 'https:'].includes(destination.protocol)) continue;
    if (options.absoluteRelativeLinks && !/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) {
      anchor.attr('href', destination.href); changed = true;
    }
    if (anchor.attr('download') !== undefined) continue;
    if (anchor.attr('target') !== '_blank') { anchor.attr('target', '_blank'); changed = true; }
    const rel = anchor.attr('rel') ?? '';
    if (!rel.split(/[\t\n\f\r ]+/).some(token => token.toLowerCase() === 'noopener')) {
      anchor.attr('rel', rel + (rel && !/[\t\n\f\r ]$/.test(rel) ? ' ' : '') + 'noopener'); changed = true;
    }
  }
  return changed ? $.root().html() ?? html : html;
}
