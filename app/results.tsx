import { addDays, todayInWarsaw, TZ, validDay } from '@/lib/dates';
import { getOffers, getTotalCount, PAGE_SIZE, type Offer } from '@/lib/offers';
import { DAY_PRESETS, SOURCES, withParams } from '@/lib/sources';
import { NavLink } from './nav';

const dayKey = new Intl.DateTimeFormat('en-CA', { timeZone: TZ }); // YYYY-MM-DD
const shortDay = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short' });
const dayLabel = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short' });
const timeLabel = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });
const fullLabel = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, dateStyle: 'full', timeStyle: 'short' });

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? '';

function groupByDay(offers: Offer[]) {
  const today = todayInWarsaw();
  const yesterday = addDays(today, -1);
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
  const days = DAY_PRESETS.some((p) => p.days && p.days === one(sp.days)) ? one(sp.days) : '';
  const from = days ? '' : validDay(one(sp.from));
  const to = days ? '' : validDay(one(sp.to));
  const filtered = Boolean(q || src || days || from || to);

  // the URL as the list understands it, for the pager links
  const current = new URLSearchParams();
  for (const [k, v] of Object.entries({ q, src, days, from, to })) if (v) current.set(k, v);

  let data: Awaited<ReturnType<typeof getOffers>>;
  let all: number | null = null; // whole table, only needed when something is filtered
  try {
    // in parallel: the filtered page and (if filtered) the unfiltered count
    [data, all] = await Promise.all([
      getOffers({ q, src, page, days, from, to }),
      filtered ? getTotalCount().catch(() => null) : Promise.resolve(null),
    ]);
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
        {/* "42 of 1,279 offers · last 7 days" when filtered, "1,279 offers" otherwise */}
        <strong>{data.total.toLocaleString('en-GB')}</strong>
        {filtered && all !== null && <> of {all.toLocaleString('en-GB')}</>} offers
        {rangeLabel(days, from, to)}
      </p>

      {data.offers.length === 0 && (
        <p className="empty">{filtered ? 'Nothing matches these filters.' : 'No offers yet. Node-RED will fill this in on its next run.'}</p>
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
            <NavLink href={withParams(current, { page: page - 1 })} scrollTop>
              ← Newer
            </NavLink>
          ) : (
            <span />
          )}
          <span>
            Page {page + 1} of {pages}
          </span>
          {page + 1 < pages ? (
            <NavLink href={withParams(current, { page: page + 1 })} scrollTop>
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

// " · last 7 days", " · 20 Sep – 28 Sep", " · since 20 Sep", " · until 28 Sep"
function rangeLabel(days: string, from: string, to: string) {
  const fmt = (d: string) => shortDay.format(new Date(d + 'T00:00:00Z'));
  if (days === '1') return ' · today';
  if (days === 'yesterday') return ' · yesterday';
  if (days) return ` · last ${days} days`;
  if (from && to) {
    const [a, b] = from <= to ? [from, to] : [to, from];
    return a === b ? ` · ${fmt(a)}` : ` · ${fmt(a)} – ${fmt(b)}`;
  }
  if (from) return ` · since ${fmt(from)}`;
  if (to) return ` · until ${fmt(to)}`;
  return '';
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
