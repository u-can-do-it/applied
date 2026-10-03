// Application pipeline, shared by server and client. Stage = how far it got; state = the
// outcome of that stage. The statistics go by the last status; the ✓ in the window by the
// history (technical / HR come in either order, so not by the position in this list).

// "invited" is the id of Initial contact (its first name): kept, so stored statuses stay valid
export const STAGES = [
  { id: 'submitted', label: 'Submitted', short: 'Submitted' },
  {
    id: 'invited',
    label: 'Initial contact',
    short: 'Initial contact',
    hint: 'they got back to you: a call, a message, an invitation',
  },
  {
    id: 'screening',
    label: 'Screening / online test',
    short: 'Screening / test',
    hint: 'a screening call, an online test or a task',
  },
  { id: 'technical', label: 'Technical interview', short: 'Technical' },
  { id: 'hr', label: 'HR interview', short: 'HR' },
  { id: 'offer', label: 'Offer', short: 'Offer' },
] as const;

export const STATES = [
  { id: 'pending', label: 'In progress' },
  { id: 'passed', label: 'Passed' },
  { id: 'failed', label: 'Rejected' },
  { id: 'ghosted', label: 'Ghosted' },
  // "we'll keep your CV in our talent pool": an answer, so it never turns into "ghosted" by itself.
  // short: where it heads a column or a tile
  {
    id: 'pool',
    label: 'CV do bazy, ty do dupy',
    short: 'Talent pool',
    hint: 'Talent pool: they keep your CV, there’s no job',
  },
] as const;

export type StageId = (typeof STAGES)[number]['id'];
export type StateId = (typeof STATES)[number]['id'];
export type HistoryEntry = { stage: StageId; state: StateId; at: string; auto?: boolean }; // auto: set by the app (ghosted after a month)

/** No news this long since the last status change: ghosted (lib/db/repos/applications.ts, ghostStale). */
export const GHOST_AFTER_DAYS = 30;
export type WithStatus = { stage: StageId; stageState: StateId; history: HistoryEntry[] };

// The Offer stage has outcomes of its own: received (still deciding), accepted, rejected. It's
// never "ghosted": the decision is yours. Same ids underneath (pending / passed / failed).
const OFFER_LABELS: Partial<Record<StateId, string>> = { pending: 'Received', passed: 'Accepted', failed: 'Rejected' };

/** The outcomes a stage can have, by their name there (an offer has no talent pool either). */
export function statesFor(stage: StageId): { id: StateId; label: string; hint?: string }[] {
  return stage === 'offer'
    ? STATES.flatMap((x) => {
        const label = OFFER_LABELS[x.id];
        return label ? [{ id: x.id, label }] : [];
      })
    : STATES.map((x) => ({ id: x.id, label: x.label, hint: 'hint' in x ? x.hint : undefined }));
}
/** An outcome's name as a heading (a column, a tile). */
export const stateHeading = (id: StateId) => {
  const x = stateOf(id);
  return 'short' in x ? x.short : x.label;
};
export const stateLabel = (stage: StageId, state: StateId) =>
  (stage === 'offer' ? OFFER_LABELS[state] : undefined) ?? stateOf(state).label;

/** Still going somewhere: in progress, or passed and waiting for the next step; an offer not decided yet. */
export const isActive = (a: { stage: StageId; stageState: StateId }) =>
  a.stage === 'offer' ? a.stageState === 'pending' : a.stageState === 'pending' || a.stageState === 'passed';
/** They said no (an offer you turned down isn't that). */
export const isRejected = (a: { stage: StageId; stageState: StateId }) =>
  a.stageState === 'failed' && a.stage !== 'offer';

export const isStage = (v: unknown): v is StageId => STAGES.some((s) => s.id === v);
export const isState = (v: unknown): v is StateId => STATES.some((s) => s.id === v);
/* eslint-disable @typescript-eslint/no-non-null-assertion -- the id's type says it is in the list */
export const stageOf = (id: StageId) => STAGES.find((s) => s.id === id)!;
export const stateOf = (id: StateId) => STATES.find((s) => s.id === id)!;
/* eslint-enable @typescript-eslint/no-non-null-assertion */

/** Every stage this application has been at (always including "submitted"). */
export function reached(a: WithStatus): Set<StageId> {
  const r = new Set<StageId>(['submitted', a.stage]);
  for (const h of a.history) r.add(h.stage);
  // got to a later stage = there was an initial contact, even if it was skipped in the app
  if (r.has('screening') || r.has('technical') || r.has('hr') || r.has('offer')) r.add('invited');
  return r;
}

export type Stats = {
  sent: number;
  positive: number; // the last status is past Submitted: they got back to you
  offers: number; // the last status is at the Offer
  active: number; // current stage in progress, or passed and waiting for the next step (isActive)
  rejected: number; // they said no (isRejected)
  ghosted: number;
  pool: number; // kept "in the talent pool"
  /** how many are at each stage now (their last status) */
  now: { stage: StageId; count: number }[];
  byStage: Record<StageId, Record<StateId, number>>;
};

export function stats(apps: WithStatus[]): Stats {
  const byStage = Object.fromEntries(
    STAGES.map((s) => [s.id, Object.fromEntries(STATES.map((x) => [x.id, 0]))]),
  ) as Stats['byStage'];
  const now = Object.fromEntries(STAGES.map((s) => [s.id, 0])) as Record<StageId, number>;
  let active = 0,
    rejected = 0,
    ghosted = 0,
    pool = 0;
  for (const a of apps) {
    byStage[a.stage][a.stageState]++;
    now[a.stage]++;
    if (isActive(a)) active++;
    else if (isRejected(a)) rejected++;
    else if (a.stageState === 'ghosted') ghosted++;
    else if (a.stageState === 'pool') pool++;
  }
  return {
    sent: apps.length,
    positive: apps.length - now.submitted,
    offers: now.offer,
    active,
    rejected,
    ghosted,
    pool,
    now: STAGES.map((s) => ({ stage: s.id, count: now[s.id] })),
    byStage,
  };
}
