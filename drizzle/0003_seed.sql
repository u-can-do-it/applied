-- Custom migration: the rows the app expects to find, and fixes to rows saved by older versions.
-- Copied from supabase/scraping.sql and supabase/ai-filter.sql (in git history), the SQL files before
-- Drizzle. Idempotent like them: each insert happens once (`on conflict do nothing`, a seed name in
-- scrape_seeds), each update only touches rows still in the old form.

-- ---- the scraping machine's state: a single row -------------------------------------------------
insert into public.scrape_state (id) values (true) on conflict (id) do nothing;
--> statement-breakpoint

-- ---- first install: the defaults and the six boards with their searches and filters -------------
with created as (
  insert into public.scrape_settings (id, settings) values (true, jsonb_build_object(
    'enabled', true,          -- scheduled runs (the "Scrape now" button works either way)
    'everyMinutes', 5,
    'fromHour', 7, 'toHour', 22, -- in the app's time zone (Settings)
    'keywords', jsonb_build_array('React'),
    'cities', jsonb_build_array('warszaw', 'warsaw'),
    'remoteOk', true,
    'ignore', jsonb_build_array(),
    'mute', jsonb_build_array('.net', 'dotnet', 'go', 'golang', 'java'),
    'notify', true))
  on conflict (id) do nothing
  returning 1
)
insert into public.scrapers (position, name, src, kind, config)
select v.position, v.name, v.src, v.kind, v.config::jsonb
from (values
  (1, 'JustJoin', 'justjoin', 'justjoin',
   '{"url": "https://justjoin.it/api/candidate-api/offers?keywords={keyword}&keywordType=any&sortBy=publishedAt&orderBy=descending&itemsCount=100", "checkKeyword": true, "checkLocation": true}'),
  (2, 'NoFluff', 'nofluff', 'nofluff',
   '{"url": "https://nofluffjobs.com/pl/{keyword_slug}?sort=newest", "checkKeyword": true, "checkLocation": true}'),
  (3, 'Solid.jobs', 'solidjobs', 'solidjobs',
   '{"url": "https://solid.jobs/public-api/offers/IT?campaign=jobwatch&search.searchTerm={keyword}&sortActive=validFrom&sortDirection=desc&pageSize=100", "headers": {"X-Api-Version": "1.0", "campaign": "44"}, "checkKeyword": true, "checkLocation": true}'),
  (4, 'Bulldog', 'bulldog', 'bulldog',
   '{"url": "https://bulldogjob.pl/companies/jobs/s/skills,{keyword}/order,published,desc", "checkKeyword": false, "checkLocation": true}'),
  (5, 'Eldorado', 'eldorado', 'eldorado',
   '{"url": "https://czyjesteldorado.pl/search?tag%5B%5D={keyword}&sort=newest", "checkKeyword": false, "checkLocation": true}'),
  (6, 'Built In', 'builtin', 'builtin',
   '{"url": "https://builtin.com/jobs/remote?search={keyword}&daysSinceUpdated=1&city=&state=&country=POL&allLocations=true", "headers": {"User-Agent": "Mozilla/5.0 (Linux; Android 16; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.12.45 Mobile Safari/537.36"}, "checkKeyword": true, "checkLocation": false}')
) as v(position, name, src, kind, config)
where exists (select 1 from created);
--> statement-breakpoint

-- scrapers added in later versions: each one once, so one you deleted doesn't come back
with first_time as (insert into public.scrape_seeds (name) values ('linkedin') on conflict (name) do nothing returning 1)
insert into public.scrapers (position, name, src, kind, config)
select v.position, v.name, 'linkedin', 'linkedin', v.config::jsonb
from (values
  (7, 'LinkedIn – Warszawa',
   '{"url": "https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search?keywords={keyword}&location=Warszawa&f_TPR=r3600&start={start}", "pages": 2, "checkKeyword": true, "checkLocation": true}'),
  (8, 'LinkedIn – remote',
   '{"url": "https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search?keywords={keyword}&location=Poland&f_WT=2&f_TPR=r3600&start={start}", "pages": 2, "checkKeyword": true, "checkLocation": true}')
) as v(position, name, config)
where exists (select 1 from first_time);
--> statement-breakpoint

-- LinkedIn's search isn't sorted by date (it ignores sortBy): the newest come from the last hour, two
-- pages. The two searches added with the first version get that, unless you changed their link.
update public.scrapers set config = config || '{"url": "https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search?keywords={keyword}&location=Warszawa&f_TPR=r3600&start={start}", "pages": 2}'::jsonb
 where kind = 'linkedin' and config->>'url' = 'https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search?keywords={keyword}&location=Warszawa&f_TPR=r86400&sortBy=DD&start=0';
--> statement-breakpoint
update public.scrapers set config = config || '{"url": "https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search?keywords={keyword}&location=Poland&f_WT=2&f_TPR=r3600&start={start}", "pages": 2}'::jsonb
 where kind = 'linkedin' and config->>'url' = 'https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search?keywords={keyword}&location=Poland&f_WT=2&f_TPR=r86400&sortBy=DD&start=0';
--> statement-breakpoint

-- Solid.jobs' campaign tag (they put it in their offer links too) was "nodered-jobwatch": now
-- "jobwatch", in the search and in the links already saved. Both open the same offer.
update public.scrapers
   set config = jsonb_set(config, '{url}', to_jsonb(replace(config->>'url', 'campaign=nodered-jobwatch', 'campaign=jobwatch')))
 where config->>'url' like '%campaign=nodered-jobwatch%';
--> statement-breakpoint
update public.offers set url = replace(url, '/nodered-jobwatch', '/jobwatch')
 where src = 'solidjobs' and url like 'https://solid.jobs/o/%/nodered-jobwatch';
--> statement-breakpoint
update public.applications set url = replace(url, '/nodered-jobwatch', '/jobwatch')
 where url like 'https://solid.jobs/o/%/nodered-jobwatch';
--> statement-breakpoint

-- ---- applications saved before the status timeline: their first entry is "submitted" -----------
update public.applications
   set history = jsonb_build_array(jsonb_build_object('stage', 'submitted', 'state', 'pending', 'at', applied_at))
 where history = '[]'::jsonb;
