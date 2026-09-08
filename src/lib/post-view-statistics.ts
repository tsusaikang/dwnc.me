import publicSequence from '../data/public-sequence-v1.json' with { type: 'json' };
import { CmsConfigurationStore } from './cms-configuration.ts';
import { NativePostStore, snapshotVisible, type NativePost } from './native-post-store.ts';

const DAY_MS = 86_400_000;
const KNOWN_BOT = /bot\b|crawler|spider|slurp|bingpreview|facebookexternalhit|whatsapp|telegrambot|discordbot|headlesschrome|lighthouse|pagespeed|curl\/|wget\/|python-requests|uptimerobot|pingdom/iu;
const dateValue = (value: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) throw new Error('ADMIN_E_STATISTICS_RANGE');
  const parsed = Date.parse(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString().slice(0, 10) !== value) throw new Error('ADMIN_E_STATISTICS_RANGE');
  return parsed;
};
export function statisticsDay(now: Date, timezone: string) {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

// These request fields are used only to exclude non-reader traffic. None is
// returned, retained in a closure, logged, hashed or stored in the database.
export function eligiblePostView(request: Request, post: Pick<NativePost, 'status' | 'visibility' | 'scheduledAt'>, response: Response, now = new Date()) {
  if (request.method !== 'GET' || response.status !== 200 || !response.headers.get('content-type')?.toLowerCase().startsWith('text/html')
    || post.status !== 'published' || !snapshotVisible(post, now)) return false;
  const url = new URL(request.url);
  if (url.hostname === 'admin.dwnc.me' || url.pathname.startsWith('/api/') || url.searchParams.has('preview')) return false;
  if (request.headers.has('cf-access-jwt-assertion') || request.headers.has('cf-access-authenticated-user-email')
    || /(?:^|;\s*)CF_Authorization=/u.test(request.headers.get('cookie') ?? '')) return false;
  if (['purpose', 'sec-purpose', 'x-purpose', 'x-moz'].some(name => /prefetch|prerender|preview/iu.test(request.headers.get(name) ?? ''))) return false;
  const destination = request.headers.get('sec-fetch-dest');
  if (destination && destination !== 'document') return false;
  const userAgent = request.headers.get('user-agent') ?? '';
  if (!userAgent || KNOWN_BOT.test(userAgent) || !/text\/html|application\/xhtml\+xml/iu.test(request.headers.get('accept') ?? '')) return false;
  try { if (new URL(request.headers.get('referer') ?? '').hostname === 'admin.dwnc.me') return false; } catch {}
  return true;
}

export class PostViewStatistics {
  private db: D1Database;
  private now: () => Date;
  constructor(db: D1Database, now: () => Date = () => new Date()) { this.db = db; this.now = now; }
  async increment(postId: string, timezone: string) {
    const day = statisticsDay(this.now(), timezone);
    // Atomic SQL increment prevents lost counts when readers arrive together.
    await this.db.prepare(`INSERT INTO post_view_daily(post_id,day,views) VALUES(?1,?2,1)
      ON CONFLICT(post_id,day) DO UPDATE SET views=views+1`).bind(postId, day).run();
  }
  async summary(parameters: URLSearchParams) {
    if ([...parameters.keys()].some(key => !['startDate', 'endDate'].includes(key))
      || [...parameters.keys()].some(key => parameters.getAll(key).length !== 1)) throw new Error('ADMIN_E_STATISTICS_RANGE');
    const timezone = (await new CmsConfigurationStore(this.db).settings()).value.timezone;
    const today = statisticsDay(this.now(), timezone);
    const endDate = parameters.get('endDate') ?? today;
    const end = dateValue(endDate);
    const startDate = parameters.get('startDate') ?? new Date(end - 29 * DAY_MS).toISOString().slice(0, 10);
    const start = dateValue(startDate);
    if (start > end || end > dateValue(today) || end - start >= 366 * DAY_MS) throw new Error('ADMIN_E_STATISTICS_RANGE');
    const [counts, days] = await this.db.batch<{ post_id?: string; total_views?: number; period_views?: number; today_views?: number; day?: string; views?: number }>([
      this.db.prepare(`SELECT post_id, SUM(views) AS total_views,
        SUM(CASE WHEN day BETWEEN ?1 AND ?2 THEN views ELSE 0 END) AS period_views,
        SUM(CASE WHEN day=?3 THEN views ELSE 0 END) AS today_views
        FROM post_view_daily GROUP BY post_id`).bind(startDate, endDate, today),
      this.db.prepare(`SELECT day,SUM(views) AS views FROM post_view_daily WHERE day BETWEEN ?1 AND ?2 GROUP BY day ORDER BY day`).bind(startDate, endDate),
    ]);
    const rows = counts.results ?? [];
    const byPost = new Map(rows.map(row => [row.post_id!, row]));
    const byDay = new Map((days.results ?? []).map(row => [row.day!, Number(row.views)]));
    const daily = [];
    for (let date = start; date <= end; date += DAY_MS) { const day = new Date(date).toISOString().slice(0, 10); daily.push({ date: day, views: byDay.get(day) ?? 0 }); }
    const posts = (await new NativePostStore(this.db).listForAdmin()).map(post => ({
      id: post.id, title: post.title || '제목 없는 초안', path: post.publicPath ?? null,
      views: Number(byPost.get(post.id)?.period_views ?? 0), totalViews: Number(byPost.get(post.id)?.total_views ?? 0),
    }));
    // A supported static fallback can be read before its metadata import finishes.
    // Keep its collected count visible without reading or copying its article body.
    for (const row of rows) {
      if (posts.some(post=>post.id===row.post_id)) continue;
      const identity=publicSequence.find(entry=>`legacy-${entry.globalSequence}`===row.post_id);
      if(identity)posts.push({id:row.post_id!,title:`기존 공개 글 #${identity.globalSequence}`,path:identity.canonicalPath,views:Number(row.period_views),totalViews:Number(row.total_views)});
    }
    posts.sort((left, right) => right.views - left.views || right.totalViews - left.totalViews || left.title.localeCompare(right.title, 'ko') || left.id.localeCompare(right.id));
    return { timezone, startDate, endDate,
      todayViews: rows.reduce((sum, row) => sum + Number(row.today_views), 0),
      totalViews: rows.reduce((sum, row) => sum + Number(row.total_views), 0),
      periodViews: rows.reduce((sum, row) => sum + Number(row.period_views), 0),
      daily, posts,
    };
  }
}
