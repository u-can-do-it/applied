# 8. Outbound requests: an SSRF policy, checked again at connect time

- Status: accepted (2026-10-03)
- Context: [`lib/outbound.ts`](../../lib/outbound.ts); [OPERATIONS.md → SSRF policy](../OPERATIONS.md#ssrf-policy)

## Context

The server fetches links it doesn't choose: scrapers' URLs typed in Settings, offers' links from the boards,
and any link pasted into "Fill in from the link". On Vercel, a request to a private address or the cloud
metadata service (`169.254.169.254`) could read what the function can reach. A check of the URL's host alone
is not enough: a public name can resolve to a private address, an IPv6 form can embed an IPv4 one
(`[::ffff:7f00:1]`), a redirect can point inward, and a name can answer differently to the check and to the
connection (DNS rebinding).

## Decision

Every such request goes through `fetchOutbound()`. In production:

- only `http:` and `https:`; `localhost` and `*.localhost` refused;
- the host is resolved and refused if **any** address is private, loopback, link-local, CGNAT, multicast,
  unspecified, reserved or documentation, including IPv6 forms that embed such an IPv4 address (mapped,
  compatible, NAT64, 6to4) and Teredo as a whole; numeric IPv4 forms are normalised by the URL parser first;
- redirects are followed by the app (`redirect: 'manual'`), at most 5 hops, each checked the same way; on a
  new origin only `User-Agent`, `Accept` and `Accept-Language` are sent on (a scraper's `Authorization` or
  cookie isn't);
- the connection goes through an undici `Agent` whose `lookup` checks the addresses it is about to connect to,
  so the address used is always one that passed: rebinding fails at connect time;
- a body is read up to 8 MB (`readText`).

A dev server (`npm run dev`) only checks the scheme, so local test pages work.

## Consequences

- A board behind a private address can't be scraped from production, by design.
- Requests to configured services (Telegram, OpenAI, `TELEGRAM_API_URL`, `OPENAI_BASE_URL`) use plain `fetch`:
  their URLs come from the environment, not from users or pages.
- `test/lib/outbound.test.ts` covers the address forms; a new outbound call must use `fetchOutbound()`.
