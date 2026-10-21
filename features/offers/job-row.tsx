import type { ReactNode } from 'react';
import { ExternalLinkIcon, NotebookPenIcon, SparklesIcon } from 'lucide-react';
import { workModeOf, workModeText, type JobDetails } from '@/lib/ads/details';
import { cn } from '@/lib/shared/cn';
import { marksWithin, type Marks } from '@/lib/shared/search';
import { Marked } from '@/components/marked';
import { Badge } from '@/components/ui/badge';
import { FitScore } from './fit-score';
import { MatchingBadge } from './matching-badge';
import { NavLink } from './nav';
import { RentADev } from './rent-a-dev';
import { RowBox } from './row-box';

// One job in a list, the offers' or the Applied tab's: the same row in both. Its title opens the ad (a new
// tab, an icon after it on hover says so), its company searches the list for it, its boards' badges their
// offers, the fit badge its checklist; a click anywhere else opens the job's window (RowBox). The tabs
// differ only in what they add: the offers' time, "new", seen mark, archive and Mark applied buttons; the
// application's status.

export const JOB_ROW = 'grid grid-cols-[1fr_auto] items-start gap-3 px-3.5 py-3';

const COMPANY_LINK = 'text-inherit no-underline hover:text-brand hover:underline hover:underline-offset-2';

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

/**
 * The row: `leading` (the offers' time), then the title (`before` and `after` it: a "new" badge, a seen
 * mark, the window's button, which a click on the row clicks), the company and `facts`, the verdict's line,
 * the note's first line; then the badges: `top`, the Rent-a-dev, fit (or, while the AI is `matching` the
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
  facts,
  verdict,
  matching = false,
  rentADev,
  note,
  marks,
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
  facts: Fact[];
  verdict?: Verdict | null;
  /** no verdict yet, and the AI is judging it now */
  matching?: boolean;
  rentADev: boolean;
  note?: string | null;
  marks?: Marks;
  boards: Board[];
  labels: Record<string, string>;
  before?: ReactNode;
  after?: ReactNode;
  top?: ReactNode;
  bottom?: ReactNode;
}) {
  const titleText = <Marked text={title} marks={marks?.title} />;
  const companyText = company && <Marked text={company} marks={marks?.company} />;
  return (
    <RowBox className={className} active={active}>
      {leading}
      <div className="min-w-0">
        <div>
          {before}
          {href ? (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              title="Open the offer's page (a new tab)"
              className="group/title font-semibold no-underline [overflow-wrap:anywhere] visited:text-muted-foreground hover:text-brand hover:underline hover:underline-offset-2"
            >
              {titleText}
              {/* on hover (or keyboard focus): it opens the board's page, not the window */}
              <ExternalLinkIcon
                aria-hidden
                className="ml-1 inline size-3.5 align-[-1px] opacity-0 transition-opacity group-hover/title:opacity-100 group-focus-visible/title:opacity-100"
              />
            </a>
          ) : (
            <span className="font-semibold [overflow-wrap:anywhere]">{titleText}</span>
          )}
          {after}
        </div>
        <div className={META}>
          {company && (
            <span>
              {companyHref ? (
                <NavLink href={companyHref} scrollTop title={`Search for ${company}`} className={COMPANY_LINK}>
                  {companyText}
                </NavLink>
              ) : onCompany ? (
                <button
                  type="button"
                  onClick={onCompany}
                  title={`Search for ${company}`}
                  className={cn(COMPANY_LINK, 'cursor-pointer')}
                >
                  {companyText}
                </button>
              ) : (
                companyText
              )}
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
      </div>
      <div className="flex flex-col items-end gap-1.5 max-[560px]:max-w-[42vw]">
        {top}
        <div className="flex flex-wrap items-center justify-end gap-1">
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
    <Badge variant="quiet" className="rounded-md no-underline" asChild>
      <a href={board.url} target="_blank" rel="noopener noreferrer" title={`Open on ${label}`}>
        {label}
      </a>
    </Badge>
  );
}
