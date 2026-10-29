import type { Application } from '@/lib/applications';
import {
  isInProcess,
  isOutcome,
  isPositive,
  isRejected,
  isStage,
  isUnanswered,
  outcomeAt,
  outcomeHeading,
  outcomeHint,
  outcomeLabel,
  outcomesFor,
  reached,
  stageOf,
  TALENT_POOL,
  type OutcomeId,
  type StageId,
} from '@/lib/stages';

// What a click on a statistic shows: the applications it counts, by their last status. Kept in the
// URL as ?status=, so a reload, a link or Back shows the same list: a tile's id (positive,
// rejected…), a stage from the funnel (hr), or from the table a stage and how it went there
// (hr-failed) or all that got to it (hr-total).

/** hint: what it counts, where the label doesn't say (Ghosted: a silent no); shown as the tile's title (tileTitle) */
export type Filter = { id: string; label: string; hint?: string; test: (app: Application) => boolean };

/** the tiles (Sent shows them all) */
export const TILES = {
  unanswered: { label: 'No answer yet', test: isUnanswered },
  process: { label: 'In progress', test: isInProcess },
  offers: { label: 'Offers', test: (app) => app.stage === 'offer' },
  positive: { label: 'Positive replies', test: isPositive },
  rejected: { label: 'Rejected', test: isRejected },
  ghosted: { label: 'Ghosted', hint: outcomeHint('ghosted'), test: (app) => app.outcome === 'ghosted' },
  withdrawn: {
    label: outcomeHeading('withdrawn'),
    hint: outcomeHint('withdrawn'),
    test: (app) => app.outcome === 'withdrawn',
  },
  pool: { label: TALENT_POOL.label, test: (app) => app.talentPool },
} satisfies Record<string, Omit<Filter, 'id'>>;
export type TileId = keyof typeof TILES;

/** A tile's tooltip (title): its name and what it counts, for the ones whose name doesn't say (Ghosted, Withdrawn). */
export function tileTitle(id: TileId): string | undefined {
  const tile: Omit<Filter, 'id'> = TILES[id];
  return tile.hint ? `${tile.label}: ${tile.hint}` : undefined;
}

/** the stage table's column of all that got to a stage */
export const TOTAL = 'total';
export const TOTAL_HEADING = 'Total';
/** a cell of the stage table, an outcome or TOTAL (a funnel bar's id is its stage) */
export const cellId = (stage: StageId, outcome: OutcomeId | typeof TOTAL) => `${stage}-${outcome}`;

/** ?status= as a filter; anything it can't be (an old or mistyped link) shows them all */
export function filterOf(id: string | null): Filter | null {
  if (!id) return null;
  if (Object.hasOwn(TILES, id)) return { id, ...TILES[id as TileId] };
  const parts = id.split('-');
  const [stage, outcome] = parts;
  if (!isStage(stage) || parts.length > 2) return null;
  if (parts.length === 1) return { id, label: stageOf(stage).label, test: (app) => app.stage === stage };
  if (outcome === TOTAL)
    return { id, label: `${stageOf(stage).short} · ${TOTAL_HEADING}`, test: (app) => reached(app).has(stage) };
  // an offer has no ghosted
  if (!isOutcome(outcome) || !outcomesFor(stage).some((possible) => possible.id === outcome)) return null;
  return {
    id,
    label: `${stageOf(stage).short} · ${outcomeLabel(stage, outcome)}`,
    test: (app) => outcomeAt(app, stage) === outcome,
  };
}
