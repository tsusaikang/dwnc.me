import * as cheerio from 'cheerio';
import type { AnyNode } from 'domhandler';
import mapLinkPolicy from '../data/public-map-links-v1.json';
import type { PostEntry } from './posts';

type MapSource = 'naver' | 'tistory';
type MapRecord = {
  source: MapSource;
  sourceId: string;
  blockIndex: number;
  title: string;
  address: string;
  linkKind: 'naver-place' | 'naver-place-existing' | 'naver-search';
  href: string;
};

function compactText(value: string) {
  return value.replace(/\s+/gu, ' ').normalize('NFC').trim();
}

function recordsFor(post: PostEntry) {
  return (mapLinkPolicy.maps as MapRecord[]).filter((record) => (
    record.source === post.data.source && record.sourceId === post.data.sourceId
  ));
}

function safeNaverMapHref(record: MapRecord) {
  let url: URL;
  try { url = new URL(record.href); }
  catch { throw new Error('MAP_E_PRESENTATION_HREF'); }
  if (url.protocol !== 'https:'
    || url.hostname !== 'map.naver.com'
    || url.username
    || url.password
    || url.port
    || !url.pathname.startsWith('/p/')) throw new Error('MAP_E_PRESENTATION_HREF');
  return record.href;
}

function mapActionLabel(record: MapRecord) {
  return record.linkKind === 'naver-search'
    ? '네이버 지도에서 검색'
    : '네이버 지도에서 보기';
}

function blockDetails(
  block: cheerio.Cheerio<AnyNode>,
  source: MapSource,
) {
  if (source === 'naver') {
    const article = block.find('.se_map_article, .se-map-article').first();
    return {
      title: compactText(article.find('.se_title, .se-title').first().text()),
      address: compactText(article.find('.se_address, .se-address').first().text()),
    };
  }
  const caption = compactText(block.find('figcaption').first().text());
  const separator = caption.indexOf(' · ');
  return separator > 0
    ? { title: caption.slice(0, separator), address: caption.slice(separator + 3) }
    : { title: caption, address: '' };
}

export function preparePublicMapLinks(post: PostEntry, html: string) {
  const source = post.data.source;
  const records = recordsFor(post);
  const $ = cheerio.load(html, null, false);
  const blocks = source === 'naver'
    ? $('.se_component.se_map, .se-component.se-map')
    : source === 'tistory'
      ? $('figure.tistory-map')
      : $('public-map-block-must-not-exist');
  if (!records.length && !blocks.length) return html;
  if (!['naver', 'tistory'].includes(source) || blocks.length !== records.length) {
    throw new Error('MAP_E_PRESENTATION_BLOCK_COUNT');
  }

  blocks.toArray().forEach((element, index) => {
    const block = $(element);
    const record = records[index];
    if (!record || record.blockIndex !== index + 1) throw new Error('MAP_E_PRESENTATION_BLOCK_ORDER');
    const details = blockDetails(block, source as MapSource);
    if (details.title !== record.title || details.address !== record.address) {
      throw new Error('MAP_E_PRESENTATION_METADATA');
    }
    const actionLabel = mapActionLabel(record);
    const replacement = $('<aside class="public-map-link" data-map-provider="naver"></aside>');
    replacement.append($('<strong class="public-map-link__title"></strong>').text(record.title));
    replacement.append($('<span class="public-map-link__address"></span>').text(record.address));
    replacement.append($('<a class="public-map-link__action"></a>')
      .attr({
        href: safeNaverMapHref(record),
        target: '_blank',
        rel: 'external noopener noreferrer',
        referrerpolicy: 'no-referrer',
        'aria-label': `${record.title} ${actionLabel}`,
      })
      .text(actionLabel));
    block.replaceWith(replacement);
  });
  return $.root().html() ?? html;
}
