const ADMIN_ORIGIN = 'https://admin.dwnc.me';
const EDIT_PATH = /^\/(?:posts\/[1-9]\d*|pages\/[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12})$/u;

export function editablePublicPath(value: string, origin: string): string | null {
  try {
    const url = new URL(value, origin);
    return url.origin === origin && !url.search && !url.hash && EDIT_PATH.test(url.pathname) ? url.pathname : null;
  } catch { return null; }
}

export function mountPublicAdminLinks() {
  const toolbar = document.querySelector<HTMLElement>('[data-public-admin-tools]');
  if (!toolbar || location.origin !== 'https://dwnc.me') return;
  let authorized = false, checking = false, frame = 0;
  let authorizationEpoch = 0, pendingRequest: AbortController | null = null;
  const linked = new WeakMap<HTMLElement, HTMLAnchorElement>();
  const attach = (host: HTMLElement, path: string, title: string, after = false) => {
    const href = `${ADMIN_ORIGIN}/#edit=${encodeURIComponent(path)}`;
    const label = `${title.trim().slice(0, 120) || '이 글'} 편집하기 (새 탭)`;
    const existing = linked.get(host);
    if (existing?.isConnected) {
      if (existing.href !== href) existing.href = href;
      if (existing.getAttribute('aria-label') !== label) existing.setAttribute('aria-label', label);
      existing.hidden = !authorized; return;
    }
    const link = document.createElement('a');
    link.className = 'public-edit-link';
    link.href = href;
    link.target = '_blank'; link.rel = 'noopener noreferrer';
    link.textContent = '편집하기 ↗';
    link.setAttribute('aria-label', label);
    link.hidden = !authorized;
    // append()/after() are also declared by the Worker HTMLRewriter ambient
    // types. These Node methods unambiguously use the browser DOM signature.
    if (after) host.parentNode?.insertBefore(link, host.nextSibling); else host.appendChild(link);
    linked.set(host, link);
  };
  const decorate = () => {
    frame = 0;
    if (!authorized) return;
    const current = editablePublicPath(location.pathname, location.origin);
    const heading = document.querySelector<HTMLElement>('.article-page .post-header__inner');
    if (current && heading) attach(heading, current, heading.querySelector('h1')?.textContent ?? '이 글');
    const selectors = [
      '.post-card h2 > a[href]', '.home-feature__copy h1 > a[href]',
      '.home-index li > a[href]', '.archive-year li > a[href]',
      '.post-related li > a[href]', '.notices li > a[href]',
      '.search-results > a[href]:not(.public-edit-link)',
    ];
    for (const anchor of document.querySelectorAll<HTMLAnchorElement>(selectors.join(','))) {
      if (anchor.classList.contains('public-edit-link')) continue;
      const path = editablePublicPath(anchor.href, location.origin); if (!path) continue;
      const host = anchor.closest<HTMLElement>('.post-card__body, .home-feature__copy, li') ?? anchor;
      attach(host, path, anchor.textContent ?? '이 글', host === anchor);
    }
  };
  const schedule = () => { if (authorized && !frame) frame = requestAnimationFrame(decorate); };
  const setAuthorized = (value: boolean) => {
    authorized = value; toolbar.hidden = !value;
    for (const link of document.querySelectorAll<HTMLAnchorElement>('.public-edit-link')) link.hidden = !value;
    schedule();
  };
  const invalidate = () => {
    authorizationEpoch++; pendingRequest?.abort(); pendingRequest = null; checking = false;
    setAuthorized(false);
  };
  const isVisible = () => document.visibilityState !== 'hidden';
  const refresh = async () => {
    if (!isVisible()) { invalidate(); return; }
    if (checking) return;
    checking = true;
    setAuthorized(false);
    const epoch = ++authorizationEpoch;
    const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 5000);
    pendingRequest = controller;
    try {
      const response = await fetch(`${ADMIN_ORIGIN}/api/session`, { credentials: 'include', mode: 'cors', cache: 'no-store', redirect: 'error', signal: controller.signal });
      const result: unknown = response.ok ? await response.json() : null;
      if (epoch === authorizationEpoch && isVisible()) setAuthorized(Boolean(result && typeof result === 'object' && (result as { authenticated?: unknown }).authenticated === true));
    } catch { if (epoch === authorizationEpoch) setAuthorized(false); }
    finally { clearTimeout(timeout); if (epoch === authorizationEpoch) { checking = false; pendingRequest = null; } }
  };
  const observer = new MutationObserver(schedule);
  observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['href'] });
  window.addEventListener('focus', refresh);
  window.addEventListener('pageshow', refresh);
  window.addEventListener('pagehide', invalidate);
  document.addEventListener('visibilitychange', refresh);
  void refresh();
}
