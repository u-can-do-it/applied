# 2. "Newest" means when Jobwatch first saw an offer (`first_seen`)

- Status: accepted (2026-10-03; in place since the first version)
- Context: [ARCHITECTURE.md → The scrape pipeline](../ARCHITECTURE.md#the-scrape-pipeline)

## Context

The offer lists are newest first, and the date filters ("today", "7 days", a range) and AI runs pick offers by
day. The boards don't share a date to do that with:

- JustJoin (`publishedAt`), No Fluff Jobs (`posted`), Solid.jobs (`validFrom`) and RSS feeds give a real date,
  but a board may renew or bump an offer, and the dates mean different things.
- Eldorado, Built In and Bulldog give only an insert counter (the parsers' `sort` is the offer id).
- LinkedIn's public search gives nothing usable (`sort` is undefined) and isn't sorted by date.

## Decision

Order and filter by `offers.first_seen`: the database's `now()` when the offer's row was inserted.
`jw_ingest_offers` inserts only offers it doesn't have (`on conflict do nothing`), so a later scrape never moves
it. A job (`offers_unique`) is dated by its earliest offer.

A board's own sort value is used only inside one scraper, as its `mark`: the newest value it has seen. An
offer at or below the mark is an old one bumped up again: saved, not announced. The mark moves only on a
successful run, and a scraper's first run (no mark yet) only saves.

## Consequences

- One ordering for every board, including the ones without dates, and stable: re-scrapes and bumps don't
  reorder the list.
- An offer scraped late (a new scraper, a board that was down) looks as new as the day it was found. The first
  run of a new scraper saves without sending, so it doesn't flood Telegram.
- Dates are the app's time zone's days turned into a half-open UTC range on `first_seen`
  (`lib/dates.ts`); the index `offers_first_seen_idx` serves them.
- The duplicate check compares jobs up to 45 days apart by `first_seen`, and the AI prompt sends it as the
  job's date.
