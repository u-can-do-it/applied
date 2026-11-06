import type { ReactNode } from 'react';
import { ExternalLinkIcon, NotebookPenIcon, SparklesIcon, TextSearchIcon } from 'lucide-react';
import { workModeOf, workModeText, type JobDetails } from '@/lib/ads/details';
import { cn } from '@/lib/shared/cn';
import { marksWithin, type Marks, type Snippet } from '@/lib/shared/search';
import { isRejected, outcomeLabel, type WithStatus } from '@/lib/stages';
import { Marked } from '@/components/marked';
import { Badge } from '@/components/ui/badge';
import { CompanyHover } from './company-hover';
import { CopyTitle } from './copy-title';
import { FitScore } from './fit-score';
import { MatchingBadge } from './matching-badge';
import { NavLink } from './nav';
import { RentADev } from './rent-a-dev';
import { RowBox } from './row-box';
import { Hint } from '@/components/hint';

// One job in a list, the offers' or the Applied tab's: the same row in both. Its title opens the ad (a new
// tab, an icon after it on hover says so; a button after that copies the title), its company searches the list for it, its boards' badges their
// offers, the fit badge its checklist; a click anywhere else opens the job's window (RowBox). The tabs
// differ only in what they add: the offers' time, "new", seen mark, archive and Mark applied buttons; the
// application's status.

export const JOB_ROW = 'grid grid-cols-[1fr_auto] items-start gap-3 px-3.5 py-3';

const COMPANY_LINK = 'text-inherit no-underline hover:text-brand hover:underline hover:underline-offset-2';

/** a company you've applied at (another job than this one): underlined with dots */
const APPLIED_HERE = 'underline decoration-dotted underline-offset-2';

const META =
  "mt-0.5 flex flex-wrap gap-x-1.5 text-[13px] text-muted-foreground [&>span+span]:before:mr-1.5 [&>span+span]:before:content-['·']";

/** One of what's said after the company (salary, contract, work mode, where). */
export type Fact = { key: string; text: string; className?: string };

/**
 * "19 300–21 000 PLN / month · B2B · Remote · Warszawa": what the board said, as both tabs show it (the
 * first salary only). `remote`: the listing's own word, for a job whose ad said nothing of where it's done.
 */
export const detailFacts = (details: JobDetails | null | undefined, remote?: boolean | null): Fact[] => {
  const mode = workModeOf(details) ?? (remote == null ? undefined : remote ? 'remote' : null);
  return [
    { key: 'salary', text: details?.salary?.split('; ')[0] },
    { key: 'contract', text: details?.contract },
    {
      key: 'mode',
      text: mode === null ? 'Office / hybrid' : workModeText({ ...details, workMode: mode }),
      className: mode === 'remote' ? 'text-success' : undefined,
    },
    { key: 'location', text: details?.location },
  ].filter((fact): fact is Fact => Boolean(fact.text));
};

type Verdict = {
  match: boolean;
  score: number;
  summary: string | null;
  checks: { item: string; met: boolean }[];
  hadDescription: boolean;
};

/** A board the job is on: a link to its offer when there's `url`. */
export type Board = { src: string; url?: string };

/** One of your applications at the job's company: its title, its day, its status, whether it's this job's own (`self`). */
export type AppliedThere = Pick<WithStatus, 'stage' | 'outcome'> & { title: string; day: string; self: boolean };

/** Your applications at the job's company, the latest first. */
export type CompanyApplied = AppliedThere[];

/**
 * How your applications at a company went, the counter's ring: how many they rejected (Rejected, an offer taken
 * back), how many went quiet (Ghosted), and the rest, still going or ended by you (`ok`).
 */
export function companyShares(apps: CompanyApplied): { ok: number; rejected: number; ghosted: number } {
  const rejected = apps.filter(isRejected).length;
  const ghosted = apps.filter((app) => app.outcome === 'ghosted').length;
  return { ok: apps.length - rejected - ghosted, rejected, ghosted };
}

/**
 * The ring as a conic gradient, clockwise from the top: green for `ok`, red for rejected, yellow for ghosted,
 * each its share of the circle.
 */
export function ringGradient({ ok, rejected, ghosted }: ReturnType<typeof companyShares>): string {
  const total = ok + rejected + ghosted || 1;
  const stops: string[] = [];
  let from = 0;
  for (const [count, color] of [
    [ok, 'var(--color-success)'],
    [rejected, 'var(--color-destructive)'],
    [ghosted, 'var(--color-warning)'],
  ] as const) {
    if (!count) continue;
    const to = from + (count / total) * 100;
    stops.push(`${color} ${+from.toFixed(2)}% ${+to.toFixed(2)}%`);
    from = to;
  }
  return `conic-gradient(${stops.join(', ')})`;
}

/** the gradient cut to a 1.5px ring: transparent inside */
const RING_MASK = 'radial-gradient(farthest-side, transparent calc(100% - 1.5px), #000 calc(100% - 1.5px))';

/** "3 applications here: 2 in progress, 1 rejected": the counter's words, each status by its count */
export function appliedCount(apps: CompanyApplied): string {
  const counts = new Map<string, number>();
  for (const app of apps) {
    const label = outcomeLabel(app.stage, app.outcome).toLowerCase();
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return `${appliedHere(apps)}: ${[...counts].map(([label, count]) => `${count} ${label}`).join(', ')}`;
}

/**
 * How many applications you have at the company, after its name, in a ring that's a pie of how they went
 * (companyShares): green still going, red rejected, yellow ghosted.
 */
function AppliedCount({ apps }: { apps: CompanyApplied }) {
  return (
    <span className="relative ml-1.5 inline-flex size-[18px] items-center justify-center align-[-1px] text-[11px] leading-none text-muted-foreground tabular-nums">
      <span
        aria-hidden
        className="absolute inset-0 rounded-full"
        style={{ background: ringGradient(companyShares(apps)), mask: RING_MASK }}
      />
      <span aria-hidden>{apps.length}</span>
      <span className="sr-only">{appliedCount(apps)}</span>
    </span>
  );
}

/** "No applications here"; "1 application here"; "3 applications here": the hover's heading, the list under it. */
export function appliedHere(apps: CompanyApplied): string {
  if (!apps.length) return 'No applications here';
  return apps.length === 1 ? '1 application here' : `${apps.length} applications here`;
}

/** applications there besides this job's own: the company is underlined with dots */
const appliedElsewhere = (apps: CompanyApplied) => apps.some((app) => !app.self);

/** The note's first line, with the search's marks in it. */
function NoteLine({ note, marks }: { note: string; marks?: number[] }) {
  const from = note.length - note.trimStart().length;
  const line = note.trim().split('\n')[0];
  return (
    <span className="mt-[3px] block truncate text-[13px] text-muted-foreground">
      <NotebookPenIcon /> <Marked text={line} marks={marksWithin(marks, from, from + line.length)} />
    </span>
  );
}

const SNIPPET_OF = { note: 'In your note', more: 'In the ad' } as const;

/** Where a search of everything matched in the note or the ad, which the row doesn't show otherwise. */
function SnippetLine({ snippet }: { snippet: Snippet }) {
  const Icon = snippet.of === 'note' ? NotebookPenIcon : TextSearchIcon;
  return (
    <Hint wrap text={SNIPPET_OF[snippet.of]} className="mt-[3px] block truncate text-[13px] text-muted-foreground">
      <Icon aria-hidden /> <span className="sr-only">{SNIPPET_OF[snippet.of]}: </span>
      <Marked text={snippet.text} marks={snippet.marks} />
    </Hint>
  );
}

/**
 * The row: `leading` (the offers' time), then the title (`before` and `after` it: a "new" badge, a seen
 * mark, the window's button, which a click on the row clicks), the company and `facts`, the verdict's line,
 * the note's first line, or where a search of everything matched in the note or the ad (`snippet`); then the badges: `top`, a repost's (`repost`), the Rent-a-dev, fit (or, while the AI is `matching` the
 * job, its "matching…") and board badges, `bottom`. A search's words are marked in the title, the company
 * and the note. The company is a link with `companyHref` (the list searching for it), or a button with
 * `onCompany`. `className`: the row's grid (JOB_ROW, or a wider one with `leading`).
 */
export function JobRow({
  className = JOB_ROW,
  active,
  leading,
  title,
  href,
  company,
  companyHref,
  onCompany,
  companyApplied,
  facts,
  verdict,
  matching = false,
  rentADev,
  repost,
  note,
  marks,
  snippet,
  boards,
  labels,
  before,
  after,
  top,
  bottom,
}: {
  className?: string;
  /** its window is open */
  active?: boolean;
  leading?: ReactNode;
  title: string;
  /** the title opens the offer (a new tab) */
  href?: string | null;
  company: string | null;
  /** the company links here */
  companyHref?: string;
  /** …or a click on it does this */
  onCompany?: () => void;
  /** your applications at its company: on the company's hover */
  companyApplied?: CompanyApplied;
  facts: Fact[];
  verdict?: Verdict | null;
  /** no verdict yet, and the AI is judging it now */
  matching?: boolean;
  rentADev: boolean;
  /** a repost's badge (repost-badge.tsx) */
  repost?: ReactNode;
  note?: string | null;
  marks?: Marks;
  snippet?: Snippet;
  boards: Board[];
  labels: Record<string, string>;
  before?: ReactNode;
  after?: ReactNode;
  top?: ReactNode;
  bottom?: ReactNode;
}) {
  const titleText = <Marked text={title} marks={marks?.title} />;
  const companyText = company && <Marked text={company} marks={marks?.company} />;
  const applied = companyApplied && appliedHere(companyApplied);
  const dotted = companyApplied && appliedElsewhere(companyApplied) && APPLIED_HERE;
  return (
    <RowBox className={className} active={active}>
      {leading}
      <div className="min-w-0">
        <div>
          {before}
          {href ? (
            <Hint wrap text="Open the offer's page (a new tab)">
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className="group/title font-semibold no-underline [overflow-wrap:anywhere] visited:text-muted-foreground hover:text-brand hover:underline hover:underline-offset-2"
              >
                {titleText}
                {/* on hover (or keyboard focus): it opens the board's page, not the window */}
                <ExternalLinkIcon
                  aria-hidden
                  className="ml-1 inline size-3.5 align-[-1px] opacity-0 transition-opacity group-hover/title:opacity-100 group-focus-visible/title:opacity-100"
                />
              </a>
            </Hint>
          ) : (
            <span className="font-semibold [overflow-wrap:anywhere]">{titleText}</span>
          )}
          <CopyTitle title={title} />
          {after}
        </div>
        <div className={META}>
          {company && (
            <span>
              <CompanyHover
                applied={applied}
                apps={companyApplied}
                search={companyHref || onCompany ? `A click searches for ${company}` : null}
              >
                {companyHref ? (
                  <NavLink href={companyHref} scrollTop className={cn(COMPANY_LINK, dotted)}>
                    {companyText}
                  </NavLink>
                ) : onCompany ? (
                  <button type="button" onClick={onCompany} className={cn(COMPANY_LINK, dotted, 'cursor-pointer')}>
                    {companyText}
                  </button>
                ) : (
                  <span className={cn(dotted)}>{companyText}</span>
                )}
                {companyApplied && companyApplied.length > 0 && <AppliedCount apps={companyApplied} />}
              </CompanyHover>
            </span>
          )}
          {facts.map((fact) => (
            <span key={fact.key} className={fact.className}>
              {fact.text}
            </span>
          ))}
        </div>
        {verdict?.summary && (
          <div className="mt-1 text-xs text-brand">
            <SparklesIcon /> {verdict.summary}
          </div>
        )}
        {note?.trim() && <NoteLine note={note} marks={marks?.note} />}
        {snippet && <SnippetLine snippet={snippet} />}
      </div>
      <div className="flex flex-col items-end gap-1.5 max-[560px]:max-w-[42vw]">
        {top}
        <div className="flex flex-wrap items-center justify-end gap-1">
          {repost}
          {rentADev && <RentADev />}
          {!verdict && matching && <MatchingBadge />}
          {verdict && (
            <FitScore
              match={verdict.match}
              score={verdict.score}
              summary={verdict.summary}
              checks={verdict.checks}
              hadDescription={verdict.hadDescription}
            />
          )}
          {boards.map((board) => (
            <BoardBadge key={board.src} board={board} label={labels[board.src] ?? board.src} />
          ))}
        </div>
        {bottom}
      </div>
    </RowBox>
  );
}

function BoardBadge({ board, label }: { board: Board; label: string }) {
  if (!board.url) {
    return (
      <Badge variant="quiet" className="rounded-md">
        {label}
      </Badge>
    );
  }
  return (
    <Hint wrap className="inline-flex" text={`Open on ${label}`}>
      <Badge variant="quiet" className="rounded-md no-underline" asChild>
        <a href={board.url} target="_blank" rel="noopener noreferrer">
          {label}
        </a>
      </Badge>
    </Hint>
  );
}
