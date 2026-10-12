-- LinkedIn's two seeded searches look back to an hour before their last complete run ({since}: the night,
-- a failed run) instead of the last hour, over up to 5 pages (a short page ends them), unless you changed
-- their link. Their next run only saves, as after any change of a search in Settings: a run of the version
-- before this one, between this migration and its deploy, sends {since} as it is, and LinkedIn then ignores
-- the window and answers offers months old, which mustn't be announced. Runs once: it looks for the old link.
update public.scrapers
   set config = config || '{"url": "https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search?keywords={keyword}&location=Warszawa&f_TPR=r{since}&start={start}", "pages": 5}'::jsonb,
       mark = null
 where kind = 'linkedin' and config->>'url' = 'https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search?keywords={keyword}&location=Warszawa&f_TPR=r3600&start={start}';
--> statement-breakpoint
update public.scrapers
   set config = config || '{"url": "https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search?keywords={keyword}&location=Poland&f_WT=2&f_TPR=r{since}&start={start}", "pages": 5}'::jsonb,
       mark = null
 where kind = 'linkedin' and config->>'url' = 'https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search?keywords={keyword}&location=Poland&f_WT=2&f_TPR=r3600&start={start}';
