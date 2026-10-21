import type { ReactNode } from 'react';
import { NotebookPenIcon, SparklesIcon } from 'lucide-react';
import { marksWithin, type Marks } from '@/lib/shared/search';
import { Marked } from '@/components/marked';
import { Badge } from '@/components/ui/badge';
import { FitScore } from './fit-score';
import { MatchingBadge } from './matching-badge';
import { NavLink } from './nav';
import { RentADev } from './rent-a-dev';

// One job in a list, the offers' or the Applied tab's: the same title, facts, verdict, badges and search
// marks in both. The caller's element is the row (JOB_ROW's grid): an offer's list item, whose title and
// boards are links, or an application's button (`inButton`), where nothing inside is clickable on its own.

export const JOB_ROW = 'grid grid-cols-[1fr_auto] items-start gap-3 px-3.5 py-3';

const META =
  "mt-0.5 flex flex-wrap gap-x-1.5 text-[13px] text-muted-foreground [&>span+span]:before:mr-1.5 [&>span+span]:before:content-['·']";

/** One of what's said after the company (seniority, salary, remote…). */
export type Fact = { key: string; text: string; className?: string };

type Verdict = {
  match: boolean;
  score: number;
  summary: string | null;
  checks: { item: string; met: boolean }[];
  hadDescription: boolean;
};

/** A board the job is on: a link to its offer when there's `url` (not in a button). */
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
 * The row's columns: the title (`before` and `after` it, say a "new" badge, a seen mark, the window's
 * button), the company and `facts`, the verdict's line, the note's first line; then the badges: `top`, the
 * Rent-a-dev, fit (or, while the AI is `matching` the job, its "matching…") and board badges, `bottom`. A
 * search's words are marked in the title, the company and the note. With `companyHref`, the company is a
 * link (the list searching for it, say).
 */
export function JobRow({
  title,
  href,
  company,
  companyHref,
  facts,
  verdict,
  matching = false,
  rentADev,
  note,
  marks,
  boards,
  labels,
  inButton = false,
  before,
  after,
  top,
  bottom,
}: {
  title: string;
  /** the title links to the offer */
  href?: string;
  company: string | null;
  /** the company links here (not in a button) */
  companyHref?: string;
  facts: Fact[];
  verdict?: Verdict | null;
  /** no verdict yet, and the AI is judging it now */
  matching?: boolean;
  rentADev: boolean;
  note?: string | null;
  marks?: Marks;
  boards: Board[];
  labels: Record<string, string>;
  /** the row is a button: no links or buttons in it */
  inButton?: boolean;
  before?: ReactNode;
  after?: ReactNode;
  top?: ReactNode;
  bottom?: ReactNode;
}) {
  // a button may hold only phrasing content: spans then, styled as blocks
  const Box = inButton ? 'span' : 'div';
  const titleText = <Marked text={title} marks={marks?.title} />;
  return (
    <>
      <Box className="block min-w-0">
        <Box className="block">
          {before}
          {href ? (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="font-semibold no-underline [overflow-wrap:anywhere] visited:text-muted-foreground hover:text-brand hover:underline hover:underline-offset-2"
            >
              {titleText}
            </a>
          ) : (
            <span className="font-semibold [overflow-wrap:anywhere] group-hover/row:text-brand group-hover/row:underline group-hover/row:underline-offset-2">
              {titleText}
            </span>
          )}
          {after}
        </Box>
        <Box className={META}>
          {company && (
            <span>
              {companyHref && !inButton ? (
                <NavLink
                  href={companyHref}
                  scrollTop
                  title={`Search for ${company}`}
                  className="text-inherit no-underline hover:text-brand hover:underline hover:underline-offset-2"
                >
                  <Marked text={company} marks={marks?.company} />
                </NavLink>
              ) : (
                <Marked text={company} marks={marks?.company} />
              )}
            </span>
          )}
          {facts.map((fact) => (
            <span key={fact.key} className={fact.className}>
              {fact.text}
            </span>
          ))}
        </Box>
        {verdict?.summary && (
          <Box className="mt-1 block text-xs text-brand">
            <SparklesIcon /> {verdict.summary}
          </Box>
        )}
        {note?.trim() && <NoteLine note={note} marks={marks?.note} />}
      </Box>
      <Box className="flex flex-col items-end gap-1.5 max-[560px]:max-w-[42vw]">
        {top}
        <Box className="flex flex-wrap items-center justify-end gap-1">
          {rentADev && <RentADev />}
          {!verdict && matching && <MatchingBadge />}
          {verdict && (
            <FitScore
              match={verdict.match}
              score={verdict.score}
              summary={verdict.summary}
              checks={verdict.checks}
              hadDescription={verdict.hadDescription}
              inButton={inButton}
            />
          )}
          {boards.map((board) => (
            <BoardBadge key={board.src} board={board} label={labels[board.src] ?? board.src} inButton={inButton} />
          ))}
        </Box>
        {bottom}
      </Box>
    </>
  );
}

function BoardBadge({ board, label, inButton }: { board: Board; label: string; inButton: boolean }) {
  if (inButton || !board.url) {
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
