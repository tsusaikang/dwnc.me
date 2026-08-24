import { createSatteriMarkdownProcessor } from '@astrojs/markdown-satteri';
import * as cheerio from 'cheerio';
import type { PostEntry } from './posts';
import { publicAddressForPost } from './public-address';
import {
  transformPublicPostLinks,
  type PublicLinkRegistry,
} from './public-links';

const DESCRIPTION_LIMIT = 260;
const markdownProcessor = createSatteriMarkdownProcessor({
  syntaxHighlight: { type: 'shiki', excludeLangs: ['math'] },
  shikiConfig: {
    theme: 'github-dark-default',
    wrap: true,
  },
  smartypants: true,
});

function compactText(value: string) {
  return value
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\s+/g, ' ')
    .normalize('NFC')
    .trim();
}

function removeNaverChrome($: cheerio.CheerioAPI) {
  $('.se_documentTitle').each((_, element) => {
    const wrapper = $(element).closest('.se_component_wrap');
    (wrapper.length ? wrapper : $(element)).remove();
  });
  $(
    '.se_doc_header_start, .se_viewer_head, .se_doc_header_end, .se_doc_contents_start, '
    + '.naver-media-placeholder, ._naverVideo, .prismplayer-area, video, '
    + 'script, style, noscript, template',
  ).remove();
}

async function visibleBody(post: PostEntry, registry: PublicLinkRegistry) {
  const body = typeof post.body === 'string' ? post.body : '';
  if (!body) return { bodyText: '', visibleImageCount: 0, unavailableCount: 0 };

  const renderedBody = post.data.source === 'naver'
    ? body
    : (await (await markdownProcessor).render(body)).code;
  const { html: presentationBody, report } = transformPublicPostLinks(renderedBody, {
    post: {
      source: post.data.source,
      sourceId: post.data.sourceId,
      canonicalPath: publicAddressForPost(post).canonicalPath,
    },
    registry,
  });
  const $ = cheerio.load(presentationBody, null, false);
  if (post.data.source === 'naver') removeNaverChrome($);
  else $('script, style, noscript, template').remove();
  return {
    bodyText: compactText($.root().text()),
    visibleImageCount: $('img').length,
    unavailableCount: report.unavailable,
  };
}

export async function derivePublicPostMetadata(post: PostEntry, registry: PublicLinkRegistry) {
  const { bodyText: publicBodyText, visibleImageCount, unavailableCount } = await visibleBody(post, registry);
  const storedDescription = compactText(post.data.description ?? '');
  const description = post.data.source === 'naver' || unavailableCount > 0
    ? (publicBodyText || storedDescription).slice(0, DESCRIPTION_LIMIT)
    : storedDescription;

  return {
    description,
    bodyText: publicBodyText,
    visibleImageCount,
  };
}

function unavailableVideoFallback($: cheerio.CheerioAPI, duration: string, labelId: string) {
  const fallback = $(
    '<div class="naver-video-fallback" data-video-fallback="unavailable" role="note"></div>',
  );
  fallback.attr('aria-labelledby', labelId);
  fallback.append($('<strong></strong>').attr('id', labelId).text('재생할 수 없는 영상'));
  fallback.append($('<p></p>').text(
    duration
      ? `이 영상은 현재 재생할 수 없습니다. 영상 길이 ${duration}`
      : '이 영상은 현재 재생할 수 없습니다.',
  ));
  return fallback;
}

function prepareNaverVideoHtml(post: PostEntry, html: string) {
  if (post.data.source !== 'naver' || !html.includes('<video')) return html;

  const $ = cheerio.load(html, null, false);
  $('video').each((videoIndex, element) => {
    const video = $(element);
    const source = video.attr('src')?.trim() || video.find('source[src]').first().attr('src')?.trim();

    if (source) {
      video.attr('playsinline', '');
      video.attr('preload', 'metadata');
      if (video.hasClass('_gifmp4')) {
        video.attr('autoplay', '');
        video.attr('muted', '');
        video.attr('loop', '');
        video.removeAttr('controls');
      } else {
        video.attr('controls', '');
      }
      return;
    }

    const player = video.closest('.se_component.se_video, ._naverVideo._vnl');
    const scope = player.length ? player : video.parent();
    const duration = compactText(scope.find('.pzp-duration-indicator').first().text());
    const captions = player.is('.se_component.se_video')
      ? player.find('.se_mediaCaption').clone()
      : null;
    const unavailableVideo = $('<video></video>').attr(element.attribs);
    const labelId = `naver-video-${post.data.sourceId}-${String(videoIndex + 1).padStart(3, '0')}-title`;
    unavailableVideo.addClass('naver-video--unavailable');
    unavailableVideo.attr('aria-hidden', 'true');
    unavailableVideo.attr('preload', 'none');
    unavailableVideo.removeAttr('autoplay controls loop muted');

    if (player.length) {
      player.empty();
      player.append(unavailableVideo);
      player.append(unavailableVideoFallback($, duration, labelId));
      if (captions?.length) player.append(captions);
    } else {
      video.replaceWith(unavailableVideo);
      unavailableVideo.after(unavailableVideoFallback($, duration, labelId));
    }
  });

  return $.root().html() ?? html;
}

export async function preparePublicPostHtml(post: PostEntry, registry: PublicLinkRegistry) {
  const body = typeof post.body === 'string' ? post.body : '';
  const renderedBody = post.data.source === 'naver'
    ? body
    : (await (await markdownProcessor).render(body, { frontmatter: post.data })).code;
  const videoPreparedBody = prepareNaverVideoHtml(post, renderedBody);
  return transformPublicPostLinks(videoPreparedBody, {
    post: {
      source: post.data.source,
      sourceId: post.data.sourceId,
      canonicalPath: publicAddressForPost(post).canonicalPath,
    },
    registry,
  }).html;
}
