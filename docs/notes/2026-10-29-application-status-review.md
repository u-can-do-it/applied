# Application stage and status: a review

- Date: 2026-10-29
- Status: findings. Acted on 2026-10-29: 3 (Withdrawn; at the Offer, Declined and Taken back) and 1's hint, with
  Passed kept at Initial contact: the outcomes a stage offers (`outcomesFor`) also decide the cells of "How far
  they got" and the `?status=` links, and Initial contact · Passed counts everyone who got past the first reply.
  2 waits for more applications that reach interviews. Recorded, as 0030 and 0031 were, in the migration
  ([0032](../../drizzle/0032_withdrawn_outcome.sql)) and the glossary, not in an ADR
- Context: [`lib/stages.ts`](../../lib/stages.ts); [`features/applications/status-editor.tsx`](../../features/applications/status-editor.tsx),
  [`status-filter.ts`](../../features/applications/status-filter.ts), [`applied-stats.tsx`](../../features/applications/applied-stats.tsx),
  [`stage-table.tsx`](../../features/applications/stage-table.tsx); [`lib/db/repos/applications.ts`](../../lib/db/repos/applications.ts)
  (`setStatus`, `ghostStale`); migrations [0028](../../drizzle/0028_passed_before.sql), [0030](../../drizzle/0030_online_test_stage.sql),
  [0031](../../drizzle/0031_talent_pool_mark.sql); [`test/lib/stages.test.ts`](../../test/lib/stages.test.ts);
  [ARCHITECTURE.md → Glossary](../ARCHITECTURE.md#glossary)

## Verdict

The model is sound and better than most job trackers. Stage and outcome as two axes, the history as the source of
truth, and the talent pool kept out of the status enum are the right calls. The weak spot is the stage list: it
hard-codes one company's pipeline, and the variation between companies (a first reply that is already a screening,
interviews split by kind and in any order) is leaking in as special cases.

## What the system is

- An application has a **stage**, seven in a fixed order (`STAGES`), and an **outcome** of that stage, four of them
  (`OUTCOMES`). Together they are its status. Every change appends a step `{ stage, state, at, auto? }` to a jsonb
  history; the current status is denormalised on the row (`stage`, `stage_state`, `stage_updated_at`).
- The tiles and the funnel go by the last status (`isInProcess`, `isUnanswered`, `isRejected`, `isPositive`). "How far
  they got" and the check marks in the window go by the history (`reached`, `outcomeAt`).
- Getting to a later stage marks the earlier ones passed by itself (`passedBefore`, steps flagged `auto`). Technical /
  HR and screening / online test are pairs (`PAIRS`) that may come in either order, so a pair member is passed only
  if it was clicked.
- Initial contact (id `invited`) is inferred whenever anything later is reached, and auto-passed when skipped.
- Ghosting is automatic after `GHOST_AFTER_DAYS` (30) of silence since the last change, `POOL_GHOST_AFTER_DAYS` (365)
  in the talent pool; never an offer. Talent pool and Rent-a-dev are flags beside the status.
- The Offer stage renames its outcomes (received / accepted / rejected) over the same ids and has no ghosted.
- A mistaken step is removed with every step after it; the first one (applying) stays.
- Each stage value is a check constraint, so a new stage is a migration, and the migrate-before-deploy order means
  a value is allowed first and used by rows only once the code that knows it is live (as 0030 did).

## The data, read on 2026-10-29

|                                                               |     |
| ------------------------------------------------------------- | --- |
| applications                                                  | 175 |
| still at Submitted (in progress, rejected or ghosted)         | 161 |
| got a reply of any kind (past Submitted)                      | 14  |
| reached a technical or HR interview                           | 3   |
| had both technical and HR                                     | 0   |
| rejection recorded as Submitted · Rejected                    | 25  |
| rejection recorded as Initial contact · Rejected              | 2   |
| Initial contact clicked by hand four times on one application | 1   |
| histories with the same status appended twice in a row        | 4   |

Most rows never leave the first stage. The detail beyond Screening is almost untested by real use, and the
technical / HR pair logic has never fired. The value of the status system is in the first two transitions: did
they reply, and what happened right after.

## Findings

### 1. Initial contact is an event, not a stage: keep it, but say what it is

The code already treats it as an event: `reached` infers it from any later stage and `passedBefore` passes it when
it was skipped. So the two cases that look ambiguous are handled today:

- an email inviting you to a screening is **Screening · In progress** (the stage is where you are, not what happened);
- a first call that is itself a screening is **Screening** too.

In both, Initial contact gets its automatic Passed. The UI never says so, which is why it gets clicked by hand, and
one history has it clicked four times (in progress, passed, in progress, in progress). The fix is in words, not in
the model:

- a hint on the chip: "they replied but named no next step; if they invited you to a screening or interview, pick
  that stage, this one is marked passed by itself";
- drop Passed from its manual outcomes (`outcomesFor`), as Offer already drops Ghosted: it's auto-only there;
- the hint should say a rejection email is Submitted · Rejected (25 rows do that, 2 chose Initial contact · Rejected).

Its buckets are worth keeping: "replied, then ghosted" is a different story from "never replied", and the data has
rows of each.

### 2. One Interview stage with a kind per step, instead of Technical and HR

Companies split interviews into technical, HR, architecture, team, final, in any order, sometimes twice. Adding
each as a stage costs a migration, a `PAIRS` entry and another near-empty column of "How far they got" every time,
and the fixed order becomes more of a fiction with each one. Proposed:

- `STAGES`: submitted, invited, screening, test, **interview**, offer;
- a history step at `interview` carries a `kind`: technical, hr, architecture, team, final, other (an enum, so it's
  a chip, not free text; "other" with the note for the rest);
- the timeline reads "Interview (architecture) · Passed", "Interview (HR) · In progress"; the chip in the list
  shows the kind of the last step;
- a stage's outcome stays its last step's (`outcomeAt` unchanged); Interview · Passed means the last interview
  went well and the next step is awaited;
- `PAIRS` shrinks to screening / test;
- "How far they got" loses the Technical and HR rows (2 and 1 applications today) and gains an Interview row that
  is reached; a by-kind breakdown can come later if it's ever wanted;
- migration: allow `interview` first, deploy, then convert `technical` → `interview` + kind technical and `hr` →
  `interview` + kind hr in rows and histories (migrate runs before deploy, so the old code must never meet
  `interview`: the two-step order of 0030).

### 3. Withdrawn as an outcome

There is no way to say you pulled out: a Rent-a-dev job declined after the first call, a salary too low to go on.
Today that is Rejected, which the stats count as "they said no" (`isRejected`), or it ghosts. Proposed:

- `OUTCOMES` gains `withdrawn` ("Withdrawn", yours not theirs), allowed at every stage, never automatic;
- it's not active, not rejected, not ghosted: its own tile or a line in the rejected tile's sub-text;
- it cleans up the Offer: today Offer · Rejected means _you_ declined and `isRejected` special-cases it; with
  Withdrawn, Offer · Withdrawn is you declining and Offer · Rejected can mean they withdrew the offer, which happens.

## Smaller things, by value

- **A step is dated when clicked, not when it happened.** An interview on Monday clicked on Wednesday is Wednesday
  in the history, and ghosting counts from Wednesday. A date on the step, as the applied day is on the form, would
  make time-between-stages honest.
- **"Positive replies" goes by the last status**, so an application rejected after a technical interview is not a
  positive reply, though it was one. The table's "Initial contact · Total" is the true reply count; a tile for it
  ("Replied") is the better funnel metric.
- **A repeated status can still be saved.** The window already ignores a click that repeats the status it
  shows ([`application-sheet.tsx`](../../features/applications/application-sheet.tsx), `setStatus`), but it
  compares with what it shows, not with the database. Four histories have a step twice in a row: Submitted ·
  In progress saved seconds after the application was created (two), and Screening · In progress and Initial
  contact · In progress saved again days later. Each repeat also restarted the ghosting clock. The repository's
  `setStatus` could skip it in the same `UPDATE`, where the stage or the outcome differs.
- **One ghosting threshold for every stage.** Silence after a technical interview is ghosting at two weeks; after
  Submitted, companies often take six. Per-stage thresholds are tuning, not design.
- **Nothing records when the next step is scheduled**; the note carries it. A "next on" date is the one thing most
  trackers have that this one lacks. Low priority.

## What should stay as it is

- the stage × outcome split (a flat status list explodes and can't answer "how far did they get");
- the history as the source of the table and the check marks, with the current status denormalised for the list;
- marks (talent pool, Rent-a-dev) outside the outcome enum (0031 was the right correction);
- automatic steps flagged `auto` and removable like any other;
- labels in one module, imported by the tests rather than retyped;
- the stored ids kept when a label changes (`invited`).

## If acted on

1 is a wording change plus one line in `outcomesFor`. 3 is an enum value, a few predicates, a tile and a
migration of the check constraint. 2 is the real change: the type of a history step, the editor, the chip, the
table, `passedBefore`, a two-step migration, and the glossary. Each would get its own ADR and commit.
