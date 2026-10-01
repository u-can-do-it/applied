import { getOffers, PAGE_SIZE, type Offer } from '@/lib/offers';
import { href, SOURCES } from '@/lib/sources';
import { NavLink } from './nav';

const TZ = 'Europe/Warsaw';
const dayKey = new Intl.DateTimeFormat('en-CA', { timeZone: TZ }); // YYYY-MM-DD
const dayLabel = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short' });
const timeLabel = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });
const fullLabel = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, dateStyle: 'full', timeStyle: 'short' });

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? '';

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

export async function Results({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const q = one(sp.q).slice(0, 200);
  const rawSrc = one(sp.src);
  const src = rawSrc in SOURCES ? rawSrc : '';
  const page = Math.max(0, Math.floor(Number(one(sp.page)) || 0));

  let data: Awaited<ReturnType<typeof getOffers>>;
  try {
    data = await getOffers({ q, src, page });
  } catch (e) {
    return (
      <div className="notice">
        <strong>Can’t load offers.</strong>
        <code>{e instanceof Error ? e.message : String(e)}</code>
      </div>
    );
  }

  const pages = Math.ceil(data.total / PAGE_SIZE);

  return (
    <>
      <p className="count">
        {data.total.toLocaleString('en-GB')} {q || src ? 'matching' : 'offers'}
      </p>

      {data.offers.length === 0 && (
        <p className="empty">{q || src ? 'Nothing matches that search.' : 'No offers yet. Node-RED will fill this in on its next run.'}</p>
      )}

      {groupByDay(data.offers).map((g) => (
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
                <span className="src">{SOURCES[o.src] ?? o.src}</span>
              </li>
            ))}
          </ol>
        </section>
      ))}

      {pages > 1 && (
        <nav className="pager" aria-label="Pages">
          {page > 0 ? (
            <NavLink href={href({ q, src, page: page - 1 })} scrollTop>
              ← Newer
            </NavLink>
          ) : (
            <span />
          )}
          <span>
            Page {page + 1} of {pages}
          </span>
          {page + 1 < pages ? (
            <NavLink href={href({ q, src, page: page + 1 })} scrollTop>
              Older →
            </NavLink>
          ) : (
            <span />
          )}
        </nav>
      )}
    </>
  );
}

export function ResultsSkeleton() {
  return (
    <div className="skeleton" aria-busy="true" aria-label="Loading offers">
      <p className="count">
        <span className="bar" style={{ width: 90 }} />
      </p>
      <section className="day">
        <h2>
          <span className="bar" style={{ width: 70 }} />
        </h2>
        <ol>
          {Array.from({ length: 8 }, (_, i) => (
            <li key={i} className="offer">
              <span className="bar" style={{ width: 36 }} />
              <div className="body">
                <span className="bar" style={{ width: `${55 + ((i * 17) % 35)}%`, height: 14 }} />
                <span className="bar" style={{ width: `${25 + ((i * 11) % 20)}%`, marginTop: 8 }} />
              </div>
              <span className="bar" style={{ width: 56 }} />
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
