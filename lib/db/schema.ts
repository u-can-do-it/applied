// The database's tables, as the migrations in drizzle/ create them. This file is the source of truth:
// change a table here, then `npm run db:generate` writes the migration. Names (tables, columns,
// constraints, indexes) are spelled out so they stay exactly those of the database created before
// Drizzle, and the baseline migration can be run on it as a no-op.
//
// Not in here, because Drizzle doesn't model them: extensions, the jw_* / ai_* functions, the
// offers_unique view's definition, grants and the pg_cron setup. They live in custom migrations
// (drizzle/0000_extensions.sql, drizzle/0002_functions.sql).
//
// No `server-only` here: drizzle-kit loads this file in plain Node.

import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  doublePrecision,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  pgView,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

const timestamptz = (name: string) => timestamp(name, { withTimezone: true });
const createdAt = () => timestamptz('created_at').notNull().defaultNow();
// Descending indexes below say `.nullsFirst()`: that's what Postgres' plain `desc` means, and what
// the database has. drizzle-kit would otherwise write `desc nulls last`, a different index.

// ---- offers: every posting a scraper saw, one row per board copy ---------------------------------

export const offers = pgTable(
  'offers',
  {
    src: text('src').notNull(), // the board (scrapers.src)
    id: text('id').notNull(), // the board's own offer id
    title: text('title').notNull(),
    company: text('company'),
    seniority: text('seniority'),
    remote: boolean('remote'),
    url: text('url').notNull(),
    firstSeen: timestamptz('first_seen').notNull().defaultNow(), // when a scraper first saw it
    // the job's key: company without legal suffix + title without gender tags (jw_dup_key)
    dupKey: text('dup_key').generatedAlwaysAs(sql`public.jw_dup_key(company, title)`),
  },
  (table) => [
    primaryKey({ name: 'offers_pkey', columns: [table.src, table.id] }),
    index('offers_first_seen_idx').on(table.firstSeen.desc().nullsFirst()),
    index('offers_dup_key_idx').on(table.dupKey, table.firstSeen),
  ],
).enableRLS();

// AI-confirmed duplicates whose keys differ: every key of a merged group points at the group's key
export const jobLinks = pgTable(
  'job_links',
  {
    dupKey: text('dup_key').primaryKey(),
    jobKey: text('job_key').notNull(),
    createdAt: createdAt(),
  },
  (table) => [index('job_links_job_key_idx').on(table.jobKey)],
).enableRLS();

// every pair the AI has looked at, so no pair is ever asked twice
export const aiDupPairs = pgTable(
  'ai_dup_pairs',
  {
    keyA: text('key_a').notNull(),
    keyB: text('key_b').notNull(),
    same: boolean('same').notNull(),
    reason: text('reason'),
    model: text('model'),
    decidedAt: timestamptz('decided_at').notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ name: 'ai_dup_pairs_pkey', columns: [table.keyA, table.keyB] }),
    check('ai_dup_pairs_check', sql`key_a < key_b`),
  ],
).enableRLS();

// ---- applications: jobs you applied to, with a snapshot of the ad --------------------------------

export const applications = pgTable(
  'applications',
  {
    dupKey: text('dup_key').primaryKey(), // the job (offers_unique.dup_key)
    src: text('src').notNull(), // the copy it was marked on
    id: text('id').notNull(),
    title: text('title').notNull(),
    company: text('company'),
    url: text('url').notNull(),
    appliedAt: timestamptz('applied_at').notNull().defaultNow(),
    content: text('content'),
    details: jsonb('details'),
    contentStatus: text('content_status').notNull().default('pending'),
    contentError: text('content_error'),
    scrapedAt: timestamptz('scraped_at'),
    stage: text('stage').notNull().default('submitted'),
    stageState: text('stage_state').notNull().default('pending'),
    stageUpdatedAt: timestamptz('stage_updated_at'),
    history: jsonb('history')
      .notNull()
      .default(sql`'[]'::jsonb`),
    note: text('note'),
    noteUpdatedAt: timestamptz('note_updated_at'),
  },
  (table) => [
    index('applications_applied_at_idx').on(table.appliedAt.desc().nullsFirst()),
    check('applications_content_status_check', sql`content_status in ('pending', 'ok', 'empty', 'failed')`),
    check('applications_stage_check', sql`stage in ('submitted', 'invited', 'screening', 'technical', 'hr', 'offer')`),
    // pool: "we'll keep your CV in our talent pool"
    check('applications_stage_state_check', sql`stage_state in ('pending', 'passed', 'failed', 'ghosted', 'pool')`),
    check('applications_note_length', sql`length(note) <= 10000`),
  ],
).enableRLS();

// ---- the AI filter: profiles, verdicts per job, runs, scraped ad text ----------------------------

export const aiProfiles = pgTable('ai_profiles', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  prompt: text('prompt').notNull().default(''),
  fileName: text('file_name'),
  fileText: text('file_text'), // text extracted from the uploaded PDF / TXT / MD
  version: integer('version').notNull().default(1), // bumped when prompt or file change
  lastUsedAt: timestamptz('last_used_at').notNull().defaultNow(), // the most recently used profile is the active one
  createdAt: createdAt(),
  updatedAt: timestamptz('updated_at').notNull().defaultNow(),
}).enableRLS();

export const aiVerdicts = pgTable(
  'ai_verdicts',
  {
    profileId: uuid('profile_id').notNull(),
    version: integer('version').notNull(),
    dupKey: text('dup_key').notNull(), // the job's key (offers_unique.dup_key)
    match: boolean('match').notNull(), // fits the profile's criteria
    score: integer('score').notNull(), // skills fit, %
    summary: text('summary'),
    checks: jsonb('checks')
      .notNull()
      .default(sql`'[]'::jsonb`), // [{ "item": "React 4+ yrs", "met": true }, ...]
    hadDescription: boolean('had_description').notNull().default(false), // false = judged on the title only
    createdAt: createdAt(),
  },
  (table) => [
    primaryKey({ name: 'ai_verdicts_pkey', columns: [table.profileId, table.version, table.dupKey] }),
    foreignKey({
      name: 'ai_verdicts_profile_id_fkey',
      columns: [table.profileId],
      foreignColumns: [aiProfiles.id],
    }).onDelete('cascade'),
    check('ai_verdicts_score_check', sql`score between 0 and 100`),
  ],
).enableRLS();

export const aiRuns = pgTable(
  'ai_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    profileId: uuid('profile_id').notNull(),
    version: integer('version').notNull(),
    label: text('label').notNull(),
    rangeGte: timestamptz('range_gte'),
    rangeLt: timestamptz('range_lt'),
    status: text('status').notNull().default('running'),
    total: integer('total').notNull().default(0),
    done: integer('done').notNull().default(0),
    error: text('error'),
    lockUntil: timestamptz('lock_until'), // one worker at a time
    createdAt: createdAt(),
    finishedAt: timestamptz('finished_at'),
    phase: text('phase').notNull().default('dedup'),
    pairsChecked: integer('pairs_checked').notNull().default(0),
    merged: integer('merged').notNull().default(0),
  },
  (table) => [
    index('ai_runs_profile_idx').on(table.profileId, table.createdAt.desc().nullsFirst()),
    foreignKey({
      name: 'ai_runs_profile_id_fkey',
      columns: [table.profileId],
      foreignColumns: [aiProfiles.id],
    }).onDelete('cascade'),
    check('ai_runs_status_check', sql`status in ('running', 'done', 'failed', 'cancelled')`),
  ],
).enableRLS();

// full ad text, scraped once per offer and reused by every profile
export const offerDetails = pgTable(
  'offer_details',
  {
    src: text('src').notNull(),
    id: text('id').notNull(),
    description: text('description'),
    status: text('status').notNull(),
    fetchedAt: timestamptz('fetched_at').notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ name: 'offer_details_pkey', columns: [table.src, table.id] }),
    foreignKey({
      name: 'offer_details_src_id_fkey',
      columns: [table.src, table.id],
      foreignColumns: [offers.src, offers.id],
    }).onDelete('cascade'),
    check('offer_details_status_check', sql`status in ('ok', 'empty')`),
  ],
).enableRLS();

// ---- scraping: the scrapers, settings, machine state, runs and the Telegram queue -----------------

// kind = the parser; src = the board as stored in offers.src (searches on one board share it)
export const scrapers = pgTable(
  'scrapers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    position: integer('position').notNull().default(0),
    name: text('name').notNull(),
    src: text('src').notNull(),
    kind: text('kind').notNull(),
    enabled: boolean('enabled').notNull().default(true),
    config: jsonb('config')
      .notNull()
      .default(sql`'{}'::jsonb`), // url, headers, filters, field paths…
    // newest "sort value" seen; older offers that show up later are saved but not announced.
    // null = never ran: the first run only saves, so a new scraper doesn't flood Telegram.
    mark: doublePrecision('mark'),
    lastRunAt: timestamptz('last_run_at'),
    lastStatus: text('last_status'),
    lastFound: integer('last_found'),
    lastKept: integer('last_kept'),
    lastNew: integer('last_new'),
    lastError: text('last_error'),
    lastMs: integer('last_ms'),
    createdAt: createdAt(),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
  },
  () => [
    check('scrapers_src_check', sql`src ~ '^[a-z0-9][a-z0-9_-]{0,29}$'`),
    check(
      'scrapers_kind_check',
      sql`kind in ('justjoin', 'nofluff', 'solidjobs', 'bulldog', 'eldorado', 'builtin', 'linkedin', 'json', 'html', 'rss')`,
    ),
    check('scrapers_status_check', sql`last_status in ('ok', 'error')`),
  ],
).enableRLS();

// a single row (id is always true)
export const scrapeSettings = pgTable(
  'scrape_settings',
  {
    id: boolean('id').primaryKey().default(true),
    settings: jsonb('settings')
      .notNull()
      .default(sql`'{}'::jsonb`),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
  },
  () => [check('scrape_settings_id_check', sql`id`)],
).enableRLS();

// a single row (id is always true)
export const scrapeState = pgTable(
  'scrape_state',
  {
    id: boolean('id').primaryKey().default(true),
    lockedUntil: timestamptz('locked_until'), // one run at a time
    lastCallAt: timestamptz('last_call_at'), // the endpoint was called (by any trigger), even if nothing was due
    lastRunAt: timestamptz('last_run_at'), // a run actually started
    muted: boolean('muted').notNull().default(false), // /mute: offers wait in notify_queue
  },
  () => [check('scrape_state_id_check', sql`id`)],
).enableRLS();

// scrapers added in later versions, each seeded once, so one you deleted doesn't come back
export const scrapeSeeds = pgTable('scrape_seeds', {
  name: text('name').primaryKey(),
  at: timestamptz('at').notNull().defaultNow(),
}).enableRLS();

export const scrapeRuns = pgTable(
  'scrape_runs',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    startedAt: timestamptz('started_at').notNull().defaultNow(),
    finishedAt: timestamptz('finished_at'),
    trigger: text('trigger').notNull(), // cron | manual | telegram
    found: integer('found').notNull().default(0), // items on the pages
    kept: integer('kept').notNull().default(0), // after keyword / city filters
    added: integer('added').notNull().default(0), // new rows in offers
    fresh: integer('fresh').notNull().default(0), // new jobs worth a message (not a copy of a known one)
    notified: integer('notified').notNull().default(0), // sent to Telegram in this run
    errors: jsonb('errors')
      .notNull()
      .default(sql`'[]'::jsonb`),
    matched: integer('matched'), // null = no AI filter
  },
  (table) => [index('scrape_runs_started_idx').on(table.startedAt.desc().nullsFirst())],
).enableRLS();

// new jobs wait here until they're sent; while muted, they pile up
export const notifyQueue = pgTable(
  'notify_queue',
  {
    src: text('src').notNull(),
    id: text('id').notNull(),
    title: text('title').notNull(),
    company: text('company'),
    seniority: text('seniority'),
    remote: boolean('remote'),
    location: text('location'),
    url: text('url').notNull(),
    queuedAt: timestamptz('queued_at').notNull().defaultNow(),
    dupKey: text('dup_key'), // the offer's job, to find its AI verdict
  },
  (table) => [primaryKey({ name: 'notify_queue_pkey', columns: [table.src, table.id] })],
).enableRLS();

// ---- views ----------------------------------------------------------------------------------------

// Each job once: its earliest copy, plus every board it was posted on. Defined in
// drizzle/0002_functions.sql (a window function); `.existing()` keeps drizzle-kit away from it.
export const offersUnique = pgView('offers_unique', {
  src: text('src').notNull(),
  id: text('id').notNull(),
  title: text('title').notNull(),
  company: text('company'),
  seniority: text('seniority'),
  remote: boolean('remote'),
  url: text('url').notNull(),
  firstSeen: timestamptz('first_seen').notNull(),
  dupKey: text('dup_key').notNull(), // the job's key: the offer's own, or its group's after an AI merge
  sources: text('sources').array().notNull(),
  copies: jsonb('copies').$type<{ src: string; id: string; url: string }[]>().notNull(),
  companyKey: text('company_key').notNull(),
  appliedAt: timestamptz('applied_at'),
}).existing();

// ---- row types --------------------------------------------------------------------------------------

export type OfferRow = typeof offers.$inferSelect;
export type NewOfferRow = typeof offers.$inferInsert;
export type JobLinkRow = typeof jobLinks.$inferSelect;
export type AiDupPairRow = typeof aiDupPairs.$inferSelect;
export type ApplicationRow = typeof applications.$inferSelect;
export type NewApplicationRow = typeof applications.$inferInsert;
export type AiProfileRow = typeof aiProfiles.$inferSelect;
export type AiVerdictRow = typeof aiVerdicts.$inferSelect;
export type AiRunRow = typeof aiRuns.$inferSelect;
export type OfferDetailsRow = typeof offerDetails.$inferSelect;
export type ScraperRow = typeof scrapers.$inferSelect;
export type NewScraperRow = typeof scrapers.$inferInsert;
export type ScrapeSettingsRow = typeof scrapeSettings.$inferSelect;
export type ScrapeStateRow = typeof scrapeState.$inferSelect;
export type ScrapeSeedRow = typeof scrapeSeeds.$inferSelect;
export type ScrapeRunRow = typeof scrapeRuns.$inferSelect;
export type NotifyQueueRow = typeof notifyQueue.$inferSelect;
export type OfferUniqueRow = typeof offersUnique.$inferSelect;
