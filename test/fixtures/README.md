# Board fixtures

One recorded listing response per board parser (`lib/listings/parsers/<board>.ts`), trimmed to a few
offers. `test/lib/listings/parse.test.ts` parses each one and snapshots the result, so a parser change
(or a re-recorded fixture) shows up in the snapshot diff.

All were recorded on **2026-10-03** with the keyword `React`: one request each, made with `curl` and
the same URLs and headers as the seeds in `drizzle/0003_seed.sql` / `listing.defaults` in `lib/boards/<board>.ts`.

| Fixture | Request | Kept |
| --- | --- | --- |
| `justjoin.json` | `https://justjoin.it/api/candidate-api/offers?keywords=React&keywordType=any&sortBy=publishedAt&orderBy=descending&itemsCount=100` | `meta` + the first 3 of `data` |
| `nofluff.html` | `https://nofluffjobs.com/pl/praca-it/react?sort=newest`, the seed at the time (answers 301 → `/pl/react?sort=newest`, followed; the seed is now `/pl/{keyword_slug}`) | the `serverApp-state` script only: the state entry with `postings` cut to the first 3 (and its `divs` / `additionalSearchDivs` dropped), plus the state entries under 5 kB, in their order; big ones (translations, store) dropped |
| `solidjobs.json` | `https://solid.jobs/public-api/offers/IT?campaign=jobwatch&search.searchTerm=React&sortActive=validFrom&sortDirection=desc&pageSize=100` with `X-Api-Version: 1.0`, `campaign: 44` | the paging fields + the first 3 of `jobs` |
| `bulldog.html` | `https://bulldogjob.pl/companies/jobs/s/skills,React/order,published,desc` | the `__NEXT_DATA__` script only; `props` cut to `pageProps.{country, totalCount, jobs}` (first 3 jobs) and `__N_SSP` |
| `eldorado.html` | `https://czyjesteldorado.pl/search?tag%5B%5D=React&sort=newest` | the flight line holding `"jobs":[…]` with the first 3 jobs, split over two `self.__next_f.push([1,"…"])` chunks (as the real page splits its data), after a `[0]` push and a small first chunk |
| `builtin.html` | `https://builtin.com/jobs/remote?search=React&daysSinceUpdated=1&city=&state=&country=POL&allLocations=true` with the seed's mobile `User-Agent` | the job cards (`<div id="job-card-…">`) in a bare page; only 2 cards were listed that day; the last card is cut where the next section (`<div id="product-cta"`) starts |
| `linkedin.html` | `https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search?keywords=React&location=Warszawa&f_TPR=r86400&start=0` | `<!DOCTYPE html>` + the first 3 `<li>` cards; the per-request `data-reference-id`, `data-tracking-id`, `refId=` and `trackingId=` values replaced with `REDACTED` |

The other requests used a desktop Chrome `User-Agent`. LinkedIn was asked for the last 24 hours
(`f_TPR=r86400`) instead of the seed's last hour, to get a full page.

## Re-recording

1. Fetch the responses above into a directory outside the repo, named after the fixture
   (`justjoin.json`, `nofluff.html`, …), e.g.
   `curl -sSL -A "$UA" -o "$DIR/nofluff.html" 'https://nofluffjobs.com/pl/react?sort=newest'`.
2. `node test/fixtures/trim.cjs "$DIR"` writes the trimmed fixtures here.
3. `npx vitest run -u test/lib/listings/parse.test.ts`, then review the snapshot diff: it is the
   change in what the parsers read. Some assertions name the recorded offers (e.g. the Eldorado skills, the Built In "Staff …" title)
   and need updating with them.
