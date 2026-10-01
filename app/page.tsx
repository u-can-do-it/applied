import Link from 'next/link';
import { getOffers, PAGE_SIZE, SOURCES, type Offer } from '@/lib/offers';
import { SearchBox } from './search-box';

const TZ = 'Europe/Warsaw';
const dayKey = new Intl.DateTimeFormat('en-CA', { timeZone: TZ }); // YYYY-MM-DD
const dayLabel = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short' });
const timeLabel = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });
const fullLabel = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, dateStyle: 'full', timeStyle: 'short' });

type Search = { q?: string; src?: string; page?: string };

function href(params: Search) {
  const sp = new URLSearchParams();
  if (params.q) sp.set('q', params.q);
  if (params.src) sp.set('src', params.src);
  if (params.page && params.page !== '0') sp.set('page', params.page);
  const s = sp.toString();
  return s ? `/?${s}` : '/';
}

function groupByDay(offers: Offer[]) {
  const now = Date.now();
  const today = dayKey.format(now);
  const yesterday = dayKey.format(now - 864e5);
  const groups: { key: string; label: string; offers: Offer[] }[] = [];
  for (const o of offers) {
    const d = new Date(o.first_seen);
    const key = dayKey.format(d);
    let g = groups.at(-1);
    if (!g || g.key !== key) {
      const label = key === today ? 'Today' : key === yesterday ? 'Yesterday' : dayLabel.format(d);
      g = { key, label, offers: [] };
      groups.push(g);
    }
    g.offers.push(o);
  }
  return groups;
}

export default async function Page({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const q = (sp.q ?? '').slice(0, 200);
  const src = sp.src && sp.src in SOURCES ? sp.src : '';
  const page = Math.max(0, Math.floor(Number(sp.page) || 0));

  let data: Awaited<ReturnType<typeof getOffers>> | null = null;
  let error: string | null = null;
  try {
    data = await getOffers({ q, src, page });
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  const pages = data ? Math.ceil(data.total / PAGE_SIZE) : 0;

  return (
    <main className="wrap">
      <header className="top">
        <h1>Jobwatch</h1>
        {data && (
          <p className="count">
            {data.total.toLocaleString('en-GB')} {q || src ? 'matching' : 'offers'}
          </p>
        )}
      </header>

      <SearchBox q={q} src={src} />

      <nav className="chips" aria-label="Filter by source">
        <Link className="chip" aria-current={!src ? 'true' : undefined} href={href({ q })}>
          All
        </Link>
        {Object.entries(SOURCES).map(([key, name]) => (
          <Link key={key} className="chip" aria-current={src === key ? 'true' : undefined} href={href({ q, src: key })}>
            {name}
          </Link>
        ))}
      </nav>

      {error && (
        <div className="notice">
          <strong>Can’t load offers.</strong>
          <code>{error}</code>
        </div>
      )}

      {data && data.offers.length === 0 && (
        <p className="empty">{q || src ? 'Nothing matches that search.' : 'No offers yet. Node-RED will fill this in on its next run.'}</p>
      )}

      {data &&
        groupByDay(data.offers).map((g) => (
          <section key={g.key} className="day">
            <h2>{g.label}</h2>
            <ol>
              {g.offers.map((o) => (
                <li key={o.src + ':' + o.id} className="offer">
                  <time dateTime={o.first_seen} title={fullLabel.format(new Date(o.first_seen))}>
                    {timeLabel.format(new Date(o.first_seen))}
                  </time>
                  <div className="body">
                    <a href={o.url} target="_blank" rel="noopener noreferrer" className="title">
                      {o.title}
                    </a>
                    <div className="meta">
                      {o.company && <span>{o.company}</span>}
                      {o.seniority && o.seniority !== 'unknown' && <span>{o.seniority}</span>}
                      <span className={o.remote ? 'remote' : undefined}>{o.remote ? 'Remote' : 'Warsaw'}</span>
                    </div>
                  </div>
                  <span className={`src src-${o.src}`}>{SOURCES[o.src] ?? o.src}</span>
                </li>
              ))}
            </ol>
          </section>
        ))}

      {pages > 1 && (
        <nav className="pager" aria-label="Pages">
          {page > 0 ? <Link href={href({ q, src, page: String(page - 1) })}>← Newer</Link> : <span />}
          <span>
            Page {page + 1} of {pages}
          </span>
          {page + 1 < pages ? <Link href={href({ q, src, page: String(page + 1) })}>Older →</Link> : <span />}
        </nav>
      )}
    </main>
  );
}
