import { categoryDisplayId } from './category-display.ts';

export interface CategoryPostLink {
  title: string;
  path: string;
  publishedAt: string;
  date: string;
  categoryId: string;
}

export const POST_CATEGORY_PAGE_SIZE = 5;
export const POST_CATEGORY_PAGE_GROUP = 7;

const escape = (value: string) => value.replace(/[&<>"']/gu, (character) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[character]!);
const sequence = (path: string) => Number(path.match(/^\/posts\/(\d+)$/u)?.[1] ?? 0);

// The caller supplies its existing public discovery list, never draft/body data.
export function categoryPostPages(posts: readonly CategoryPostLink[], categoryId: string, currentPath: string) {
  const ordered = posts.filter((post) => categoryDisplayId(post.categoryId) === categoryDisplayId(categoryId))
    .sort((left, right) => Date.parse(right.publishedAt) - Date.parse(left.publishedAt)
      || sequence(right.path) - sequence(left.path));
  const currentIndex = ordered.findIndex((post) => post.path === currentPath);
  const pages: CategoryPostLink[][] = [];
  for (let index = 0; index < ordered.length; index += POST_CATEGORY_PAGE_SIZE) {
    pages.push(ordered.slice(index, index + POST_CATEGORY_PAGE_SIZE));
  }
  return { pages, initialPage: Math.floor(Math.max(0, currentIndex) / POST_CATEGORY_PAGE_SIZE) + 1 };
}

export const POST_CATEGORY_PAGINATION_SCRIPT = String.raw`(() => {
  document.querySelectorAll('[data-post-category-pagination]').forEach((section) => {
    if (section.dataset.paginationReady) return;
    section.dataset.paginationReady = 'true';
    const pages = Array.from(section.querySelectorAll('[data-category-page]'));
    const buttons = Array.from(section.querySelectorAll('[data-category-page-button]'));
    const previous = section.querySelector('[data-category-page-previous]');
    const next = section.querySelector('[data-category-page-next]');
    const status = section.querySelector('[data-category-page-status]');
    if (!previous || !next || !status) return;
    const show = (page, moveFocus) => {
      if (!Number.isInteger(page) || page < 1 || page > pages.length) return;
      const start = Math.floor((page - 1) / 7) * 7 + 1;
      const end = Math.min(start + 6, pages.length);
      pages.forEach((list, index) => { list.hidden = index + 1 !== page; });
      buttons.forEach((button) => {
        const number = Number(button.dataset.categoryPageButton);
        button.hidden = number < start || number > end;
        if (number === page) button.setAttribute('aria-current', 'page');
        else button.removeAttribute('aria-current');
      });
      previous.disabled = start === 1;
      previous.dataset.categoryPageTarget = String(start - 1);
      next.disabled = end === pages.length;
      next.dataset.categoryPageTarget = String(end + 1);
      status.textContent = page + ' / ' + pages.length + ' 페이지';
      if (moveFocus) buttons[page - 1].focus({ preventScroll: true });
    };
    section.addEventListener('click', (event) => {
      const button = event.target.closest('button');
      if (!button || !section.contains(button) || button.disabled) return;
      const page = Number(button.dataset.categoryPageButton || button.dataset.categoryPageTarget);
      show(page, true);
    });
  });
})();`;

export function renderPostCategoryPagination(posts: readonly CategoryPostLink[], categoryId: string, currentPath: string, categoryHref: string) {
  const { pages, initialPage } = categoryPostPages(posts, categoryId, currentPath);
  if (!pages.length) return '';
  const start = Math.floor((initialPage - 1) / POST_CATEGORY_PAGE_GROUP) * POST_CATEGORY_PAGE_GROUP + 1;
  const end = Math.min(start + POST_CATEGORY_PAGE_GROUP - 1, pages.length);
  const lists = pages.map((items, index) => `<ol data-category-page="${index + 1}"${index + 1 !== initialPage ? ' hidden' : ''}>${items.map((item) => `<li${item.path === currentPath ? ' class="post-related__current"' : ''}><a href="${escape(item.path)}"${item.path === currentPath ? ' aria-current="page"' : ''}>${escape(item.title)}${item.path === currentPath ? '<span class="post-related__current-label">현재 글</span>' : ''}</a><time datetime="${escape(item.publishedAt)}">${escape(item.date)}</time></li>`).join('')}</ol>`).join('');
  const controls = pages.length > 1 ? `<nav class="post-related__pagination" aria-label="같은 카테고리 글 목록 페이지"><button type="button" data-category-page-previous data-category-page-target="${start - 1}" aria-label="이전 페이지 묶음" aria-controls="post-category-pages"${start === 1 ? ' disabled' : ''}>«</button>${pages.map((_, index) => `<button type="button" data-category-page-button="${index + 1}" aria-label="${index + 1}페이지" aria-controls="post-category-pages"${index + 1 === initialPage ? ' aria-current="page"' : ''}${index + 1 < start || index + 1 > end ? ' hidden' : ''}>${index + 1}</button>`).join('')}<button type="button" data-category-page-next data-category-page-target="${end + 1}" aria-label="다음 페이지 묶음" aria-controls="post-category-pages"${end === pages.length ? ' disabled' : ''}>»</button></nav><p class="post-related__page-status" data-category-page-status role="status" aria-live="polite" aria-atomic="true">${initialPage} / ${pages.length} 페이지</p><noscript><p><a href="${escape(categoryHref)}">같은 카테고리 전체 보기</a></p></noscript><script>${POST_CATEGORY_PAGINATION_SCRIPT}</script>` : '';
  return `<section class="post-related" data-post-category-pagination aria-labelledby="post-related-title"><h2 id="post-related-title">같은 카테고리의 글</h2><div id="post-category-pages">${lists}</div>${controls}</section>`;
}
