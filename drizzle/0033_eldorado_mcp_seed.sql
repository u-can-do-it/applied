-- Eldorado's seeded search as the registry has it since ADR 0010 (lib/boards/eldorado.ts): its MCP server's
-- search_jobs, not its search page, which its Cloudflare keeps from a datacenter. 0003_seed.sql inserted the
-- page's link, which the MCP client refuses (lib/listings/eldorado-mcp.ts), so a fresh install's Eldorado
-- failed every run until its link was changed in Settings. Only one still on that link: one you changed is
-- yours. As after a change of a search in Settings, its next run only saves (mark) and the old search's
-- follow-up is dropped. Safe for the previous code: it reads this link already. Runs once: it looks for the
-- old link.
update public.scrapers
   set config = config || '{"url": "https://czyjesteldorado.pl/_mcp?phrase={keyword}&sortOrder=newest", "checkKeyword": true}'::jsonb,
       mark = null,
       follow_up = null,
       updated_at = now()
 where kind = 'eldorado' and config->>'url' = 'https://czyjesteldorado.pl/search?tag%5B%5D={keyword}&sort=newest';
