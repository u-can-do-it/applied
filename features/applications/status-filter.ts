import type { Application } from '@/lib/applications';
import {
  isInProcess,
  isOutcome,
  isPositive,
  isRejected,
  isStage,
  isUnanswered,
  outcomeHeading,
  outcomeLabel,
  outcomesFor,
  stageOf,
  type OutcomeId,
  type StageId,
} from '@/lib/stages';

// What a click on a statistic shows: the applications it counts, by their last status. Kept in the
// URL as ?status=, so a reload, a link or Back shows the same list: a tile's id (positive,
// rejected…), a stage from the funnel (hr), or a stage and outcome from the table (hr-failed).

export type Filter = { id: string; label: string; test: (app: Application) => boolean };

/** the tiles (Sent shows them all) */
export const TILES = {
  positive: { label: 'Positive replies', test: isPositive },
  offers: { label: 'Offers', test: (app) => app.stage === 'offer' },
  process: { label: 'In progress', test: isInProcess },
  unanswered: { label: 'No answer yet', test: isUnanswered },
  rejected: { label: 'Rejected', test: isRejected },
  ghosted: { label: 'Ghosted', test: (app) => app.outcome === 'ghosted' },
  pool: { label: outcomeHeading('pool'), test: (app) => app.outcome === 'pool' },
} satisfies Record<string, Omit<Filter, 'id'>>;
export type TileId = keyof typeof TILES;

/** a cell of the stage table (a funnel bar's id is its stage) */
export const cellId = (stage: StageId, outcome: OutcomeId) => `${stage}-${outcome}`;

/** ?status= as a filter; anything it can't be (an old or mistyped link) shows them all */
export function filterOf(id: string | null): Filter | null {
  if (!id) return null;
  if (Object.hasOwn(TILES, id)) return { id, ...TILES[id as TileId] };
  const parts = id.split('-');
  const [stage, outcome] = parts;
  if (!isStage(stage) || parts.length > 2) return null;
  if (parts.length === 1) return { id, label: stageOf(stage).label, test: (app) => app.stage === stage };
  // an offer has no ghosted or talent pool
  if (!isOutcome(outcome) || !outcomesFor(stage).some((possible) => possible.id === outcome)) return null;
  return {
    id,
    label: `${stageOf(stage).short} · ${outcomeLabel(stage, outcome)}`,
    test: (app) => app.stage === stage && app.outcome === outcome,
  };
}
