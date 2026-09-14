import { escapeHtml } from './native-content.ts';

export interface ListingPost {
  title: string;
  path: string;
  date: string;
  publishedAt: string;
  cover?: string | null;
  coverAlt?: string;
  leafCategory: { label: string };
}

// Both public renderers receive already-public, newest-first posts and selected covers.
export function renderRecentJournal(posts: ListingPost[], firstYear: number | string, lastYear: number) {
  const cards = posts.slice(0, 8).map((post, index) => `<article class="recent-card${post.cover ? '' : ' recent-card--text'}">${post.cover ? `<a class="recent-card__image" href="${escapeHtml(post.path)}" tabindex="-1" aria-hidden="true"><img src="${escapeHtml(post.cover)}" alt="${escapeHtml(post.coverAlt ?? '')}" decoding="async" ${index < 2 ? 'fetchpriority="high"' : 'loading="lazy"'}></a>` : ''}<div class="recent-card__body"><p class="recent-card__meta"><time datetime="${escapeHtml(post.publishedAt)}">${escapeHtml(post.date)}</time><span>${escapeHtml(post.leafCategory.label)}</span></p><h2><a href="${escapeHtml(post.path)}">${escapeHtml(post.title)}</a></h2><a class="text-link" href="${escapeHtml(post.path)}">이 글 읽기 <span aria-hidden="true">↗</span></a></div></article>`).join('');
  return `<section class="recent-journal" aria-labelledby="recent-title"><header class="recent-journal__heading"><div><p class="eyebrow">${escapeHtml(String(firstYear))}—${lastYear}</p><h1 id="recent-title">최근 기록</h1></div><button type="button" data-search-open>찾기</button></header><div class="recent-grid">${cards}</div><a class="text-link recent-journal__all" href="/archive">모든 글 보기 <span aria-hidden="true">↗</span></a></section>`;
}

export function renderArchiveRow(post: ListingPost) {
  return `<li class="archive-entry"><a class="archive-entry__link${post.cover ? ' archive-entry__link--image' : ''}" href="${escapeHtml(post.path)}">${post.cover ? `<img class="archive-entry__image" src="${escapeHtml(post.cover)}" alt="" loading="lazy" decoding="async">` : ''}<span class="archive-entry__copy"><span class="archive-entry__title">${escapeHtml(post.title)}</span><span class="archive-entry__meta"><time datetime="${escapeHtml(post.publishedAt)}">${escapeHtml(post.date.slice(5))}</time><small>${escapeHtml(post.leafCategory.label)}</small></span></span></a></li>`;
}
