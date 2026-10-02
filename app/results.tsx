import { rangeStats } from '@/lib/ai-runs';
import { addDays, describeRange, resolveRange, todayInWarsaw, TZ, validDay } from '@/lib/dates';
import { getOffers, getTotalCount, PAGE_SIZE, type Offer } from '@/lib/offers';
import { isUsable, listProfiles } from '@/lib/profiles';
import { SRC_RE } from '@/lib/scraping/kinds';
import { labelsOf, type SourceOption } from '@/lib/source-list';
import { DAY_PRESETS, withParams } from '@/lib/sources';
import { ApplyButton } from './apply-button';
import { FitScore } from './fit-score';
import { NavLink } from './nav';

const dayKey = new Intl.DateTimeFormat('en-CA', { timeZone: TZ }); // YYYY-MM-DD
const weekday = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, weekday: 'short' });
const dmy = new Intl.DateTimeFormat('pl-PL', { timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric' }); // 02.10.2026
const dayLabel = { format: (d: Date) => `${weekday.format(d)} ${dmy.format(d)}` }; // "Thu 02.10.2026"
const timeLabel = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });
const fullLabel = { format: (d: Date) => `${dayLabel.format(d)}, ${timeLabel.format(d)}` }; // "Thu 02.10.2026, 14:05"

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? '';
const fmt = (n: number) => n.toLocaleString('en-GB');

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

/** The boards this job was posted on, one link each (earliest first). */
function Sources({ offer, labels }: { offer: Offer; labels: Record<string, string> }) {
  const seen = new Set<string>();
  const links = offer.copies.filter((c) => !seen.has(c.src) && seen.add(c.src));
  return (
    <span className="sources">
      {links.map((c) => (
        <a key={c.src} className="src" href={c.url} target="_blank" rel="noopener noreferrer" title={`Open on ${labels[c.src] ?? c.src}`}>
          {labels[c.src] ?? c.src}
        </a>
      ))}
    </span>
  );
}

export async function Results({ searchParams, mode = 'all', sources }: {
  searchParams: SearchParams;
  mode?: 'all' | 'ai';
  sources: Promise<SourceOption[]>;
}) {
  const path = mode === 'ai' ? '/ai' : '/';
  const sp = await searchParams;
  const q = one(sp.q).slice(0, 200);
  const rawSrc = one(sp.src);
  const src = SRC_RE.test(rawSrc) ? rawSrc : ''; // an unknown board just finds nothing
  const page = Math.max(0, Math.floor(Number(one(sp.page)) || 0));
  const days = DAY_PRESETS.some((p) => p.days && p.days === one(sp.days)) ? one(sp.days) : '';
  const from = days ? '' : validDay(one(sp.from));
  const to = days ? '' : validDay(one(sp.to));
  const rejected = mode === 'ai' && one(sp.rejected) === '1';
  const filtered = Boolean(q || src || days || from || to);
  const range = describeRange({ days, from, to });

  // the URL as the list understands it, for the pager links
  const current = new URLSearchParams();
  for (const [k, v] of Object.entries({ q, src, days, from, to, rejected: rejected ? '1' : '' })) if (v) current.set(k, v);

  let data: Awaited<ReturnType<typeof getOffers>>;
  let all: number | null = null; // whole table, only needed when something is filtered
  let stats: { total: number; checked: number; matched: number } | null = null; // AI: this date range
  try {
    if (mode === 'ai') {
      const profile = (await listProfiles())[0];
      if (!isUsable(profile)) {
        return (
          <p className="empty">
            No profile yet. Click <strong>✦ Profile</strong> above, describe what you&apos;re looking for and add your CV.
          </p>
        );
      }
      [data, stats] = await Promise.all([
        getOffers({ q, src, page, days, from, to, ai: { profileId: profile.id, version: profile.version, rejected } }),
        rangeStats(profile, resolveRange({ days, from, to })),
      ]);
    } else {
      // in parallel: the filtered page and (if filtered) the unfiltered count
      [data, all] = await Promise.all([
        getOffers({ q, src, page, days, from, to }),
        filtered ? getTotalCount().catch(() => null) : Promise.resolve(null),
      ]);
    }
  } catch (e) {
    return (
      <div className="notice">
        <strong>Can’t load offers.</strong>
        <code>{e instanceof Error ? e.message : String(e)}</code>
      </div>
    );
  }

  const pages = Math.ceil(data.total / PAGE_SIZE);
  const unchecked = stats ? stats.total - stats.checked : 0;
  const labels = labelsOf(await sources); // fetched alongside, usually in by now

  return (
    <>
      {mode === 'ai' && stats ? (
        <p className="count">
          {/* "9 match of 14 checked · 6 not checked yet · today · show 5 rejected" */}
          <strong>{fmt(stats.matched)}</strong> match of {fmt(stats.checked)} checked
          {unchecked > 0 && <span className="warn"> · {fmt(unchecked)} not checked yet</span>}
          {range && ` · ${range}`}
          {(q || src) && <> · {fmt(data.total)} shown</>}
          {' · '}
          <NavLink href={withParams(current, { rejected: rejected ? null : '1' }, path)}>
            {rejected ? 'show matches' : `show ${fmt(stats.checked - stats.matched)} rejected`}
          </NavLink>
        </p>
      ) : (
        <p className="count">
          {/* "42 of 1,279 offers · last 7 days" when filtered, "1,279 offers" otherwise */}
          <strong>{fmt(data.total)}</strong>
          {filtered && all !== null && <> of {fmt(all)}</>} offers
          {range && ` · ${range}`}
        </p>
      )}

      {data.offers.length === 0 && (
        <p className="empty">
          {mode === 'ai'
            ? stats && stats.checked === 0
              ? `Nothing ${range ? `from ${range} ` : ''}has been checked with this profile yet. Use the buttons above.`
              : rejected
                ? 'Nothing was rejected here.'
                : 'No matches here. Check the rejected ones, or loosen the profile.'
            : filtered
              ? 'Nothing matches these filters.'
              : 'No offers yet. Use “↻ Scrape now” at the top, or wait for the next scheduled run.'}
        </p>
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
                    <span className={o.remote ? 'remote' : undefined}>{o.remote ? 'Remote' : 'Office / hybrid'}</span>
                  </div>
                  {o.ai?.summary && <p className="ai-reason">✦ {o.ai.summary}</p>}
                </div>
                <div className="side">
                  {o.ai && (
                    <FitScore
                      tipId={`fit-${o.src}-${o.id}`.replace(/[^a-zA-Z0-9_-]/g, '_')}
                      score={o.ai.score}
                      summary={o.ai.summary}
                      checks={o.ai.checks}
                      hadDescription={o.ai.had_description}
                    />
                  )}
                  <Sources offer={o} labels={labels} />
                  {o.key && <ApplyButton jobKey={o.key} src={o.src} id={o.id} appliedAt={o.applied_at} />}
                </div>
              </li>
            ))}
          </ol>
        </section>
      ))}

      {pages > 1 && (
        <nav className="pager" aria-label="Pages">
          {page > 0 ? (
            <NavLink href={withParams(current, { page: page - 1 }, path)} scrollTop>
              ← Newer
            </NavLink>
          ) : (
            <span />
          )}
          <span>
            Page {page + 1} of {pages}
          </span>
          {page + 1 < pages ? (
            <NavLink href={withParams(current, { page: page + 1 }, path)} scrollTop>
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
