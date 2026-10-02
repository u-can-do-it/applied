// Application pipeline, shared by server and client. Stage = how far it got; state = the
// outcome of that stage. Order of technical / HR differs per company, so "reached" comes from
// the history, not from the position in this list.

export const STAGES = [
  { id: 'submitted', label: 'Submitted', short: 'Submitted' },
  { id: 'invited', label: 'Positive reply / invited', short: 'Invited', hint: 'invited to an interview or a test' },
  { id: 'technical', label: 'Technical interview', short: 'Technical' },
  { id: 'hr', label: 'HR interview', short: 'HR' },
  { id: 'offer', label: 'Offer', short: 'Offer' },
] as const;

export const STATES = [
  { id: 'pending', label: 'In progress' },
  { id: 'passed', label: 'Passed' },
  { id: 'failed', label: 'Rejected' },
  { id: 'ghosted', label: 'Ghosted' },
] as const;

export type StageId = (typeof STAGES)[number]['id'];
export type StateId = (typeof STATES)[number]['id'];
export type HistoryEntry = { stage: StageId; state: StateId; at: string };
export type WithStatus = { stage: StageId; stage_state: StateId; history: HistoryEntry[] | null };

export const isStage = (v: unknown): v is StageId => STAGES.some((s) => s.id === v);
export const isState = (v: unknown): v is StateId => STATES.some((s) => s.id === v);
export const stageOf = (id: StageId) => STAGES.find((s) => s.id === id)!;
export const stateOf = (id: StateId) => STATES.find((s) => s.id === id)!;

/** Every stage this application has been at (always including "submitted"). */
export function reached(a: WithStatus): Set<StageId> {
  const r = new Set<StageId>(['submitted', a.stage]);
  for (const h of a.history ?? []) r.add(h.stage);
  // got to a later stage = there was a positive reply, even if "invited" was skipped in the app
  if (r.has('technical') || r.has('hr') || r.has('offer')) r.add('invited');
  return r;
}

export type Stats = {
  sent: number;
  positive: number; // reached "invited" or later
  offers: number; // reached "offer"
  active: number; // current stage in progress, or passed and waiting for the next step
  rejected: number;
  ghosted: number;
  funnel: { stage: StageId; count: number }[];
  byStage: Record<StageId, Record<StateId, number>>;
};

export function stats(apps: WithStatus[]): Stats {
  const byStage = Object.fromEntries(STAGES.map((s) => [s.id, Object.fromEntries(STATES.map((x) => [x.id, 0]))])) as Stats['byStage'];
  const funnel = Object.fromEntries(STAGES.map((s) => [s.id, 0])) as Record<StageId, number>;
  let active = 0, rejected = 0, ghosted = 0;
  for (const a of apps) {
    byStage[a.stage][a.stage_state]++;
    for (const s of reached(a)) funnel[s]++;
    if (a.stage_state === 'failed') rejected++;
    else if (a.stage_state === 'ghosted') ghosted++;
    else active++;
  }
  return {
    sent: apps.length,
    positive: funnel.invited,
    offers: funnel.offer,
    active,
    rejected,
    ghosted,
    funnel: STAGES.map((s) => ({ stage: s.id, count: funnel[s.id] })),
    byStage,
  };
}
