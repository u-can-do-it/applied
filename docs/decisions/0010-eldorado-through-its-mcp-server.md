# 10. Eldorado's search through its MCP server

- Status: accepted (2026-10-19)
- Context: [`lib/listings/eldorado-mcp.ts`](../../lib/listings/eldorado-mcp.ts);
  [`lib/scraping-ant.ts`](../../lib/scraping-ant.ts); [ADR 0008](0008-ssrf-policy-connect-time-checks.md)

## Context

Eldorado's Cloudflare answers a datacenter with a challenge, so its search page was fetched through ScrapingAnt's
Polish datacenter proxies, 1 credit a page. Since mid-October 2026 it sees through every one of them, in every
country ScrapingAnt has, and through its browser mode too; only a residential proxy gets through, at 25 credits a
page (measured on the account's usage). One search every 3 hours came to ~3,750 of the free plan's 10,000 credits a
month, and its ads, 25 credits each, were out of reach.

Eldorado runs an MCP server of its own, announced as a beta for, among other things, monitoring offers
([discussion #54](https://github.com/orgs/Czy-Jest-Eldorado/discussions/54)): `https://czyjesteldorado.pl/_mcp`,
whose `search_jobs` tool takes a phrase, a sort order and filters, and answers the newest 50 matching jobs with
their title, keywords, company, cities, work modes, seniority, salary, date and link. Its Cloudflare doesn't
challenge it from a datacenter.

## Decision

Eldorado's scraper calls `search_jobs` instead of fetching its search page. Its link names the search: the
endpoint, with the tool's arguments as its query (`https://czyjesteldorado.pl/_mcp?phrase={keyword}&sortOrder=newest`),
so it is edited, tested and expanded per keyword like any other scraper's. The client opens a session, calls the
tool and closes the session; the parser reads the structured answer. The request always goes to the fixed
endpoint, never to the link's host, so it is a plain `fetch` (as for ScrapingAnt's API), not `fetchOutbound()`.
The offers keep the ids and links of the search page's (`/praca/<id>-…`), so the ones already saved still match.

The residential proxy fallback is gone with it; Eldorado no longer counts as a board that blocks the server.

## Consequences

- Eldorado costs no ScrapingAnt credits, and its scraper runs on every scheduled run again.
- It depends on a beta: the tool may change shape or go away without notice. A changed answer fails the scraper
  with what's wrong (Activity shows it); then the search page through a residential proxy is the fallback.
- Its ad pages still can't be read (they stay behind the challenge), so an Eldorado offer's ad is what the same
  tool lists about it, searched by its id (`#<id>`, [`lib/ads/eldorado.ts`](../../lib/ads/eldorado.ts)): the
  window's salary, contract, places, work mode, date and skills, and a text of them for the AI filter. The ad's
  own words aren't there.
- No paging: 50 jobs a search, plenty for a run every 10 minutes.
