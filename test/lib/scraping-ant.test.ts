import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchPage } from '@/lib/listings/pipeline/fetch';
import { fetchOutbound } from '@/lib/outbound';

// fetchOutbound on a board that blocks the server (Eldorado): a refused page goes again through
// ScrapingAnt. Not production, so no DNS: `fetch` alone is stubbed, the site and ScrapingAnt both.

const AD = 'https://czyjesteldorado.pl/praca/455630-lider-technologiczny';
const KEY = 'ant-test-key';

const challenge = () => new Response('<title>Just a moment...</title>', { status: 403 });
const viaAnt = (body: string, page = 200, status = 200) =>
  new Response(body, { status, headers: { 'Ant-Page-Status-Code': String(page), 'Content-Type': 'text/html' } });
const isAnt = (input: unknown) => String(input).startsWith('https://api.scrapingant.com/');

/** `fetch` answering the site with `site` and ScrapingAnt with each of `ant` in turn; records the calls. */
function stubFetch(site: () => Response, ...ant: (() => Response)[]) {
  const calls: string[] = [];
  const fetch = vi.fn((input: unknown) => {
    calls.push(String(input));
    if (!isAnt(input)) return Promise.resolve(site());
    const next = ant.shift();
    if (!next) throw new Error('ScrapingAnt asked more times than expected');
    return Promise.resolve(next());
  });
  vi.stubGlobal('fetch', fetch);
  return calls;
}

beforeEach(() => {
  vi.stubEnv('SCRAPINGANT_API_KEY', KEY);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe('a board that blocks the server', () => {
  it('a refused page is fetched again through ScrapingAnt, as the site answered it there', async () => {
    const calls = stubFetch(challenge, () => viaAnt('<html>the ad</html>'));
    const res = await fetchOutbound(AD);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('<html>the ad</html>');
    expect(calls).toHaveLength(2);
    const api = new URL(calls[1]);
    expect(api.searchParams.get('url')).toBe(AD);
    expect(api.searchParams.get('x-api-key')).toBe(KEY);
    expect(api.searchParams.get('browser')).toBe('false'); // the 1-credit request
    expect(api.searchParams.get('proxy_country')).toBe('PL'); // the only proxies Eldorado lets through
  });

  it('a proxy the site saw through is tried again, from another one, at once', async () => {
    const detected = () => Response.json({ detail: 'Our browser was detected by target site' }, { status: 423 });
    const calls = stubFetch(challenge, detected, detected, () => viaAnt('<html>the ad</html>'));
    expect(await (await fetchOutbound(AD)).text()).toBe('<html>the ad</html>');
    expect(calls.filter(isAnt)).toHaveLength(3);
  });

  it("seen through on every try, it fails in ScrapingAnt's words", async () => {
    const detected = () => Response.json({ detail: 'Our browser was detected by target site' }, { status: 423 });
    const calls = stubFetch(challenge, ...Array.from({ length: 8 }, () => detected));
    await expect(fetchOutbound(AD)).rejects.toThrow('ScrapingAnt 423: Our browser was detected by target site');
    expect(calls.filter(isAnt)).toHaveLength(8);
  });

  it("the site's own status comes through (an ad taken down: 404)", async () => {
    stubFetch(challenge, () => viaAnt('gone', 404));
    expect((await fetchOutbound(AD)).status).toBe(404);
  });

  it('no credit is spent when the site lets the server in', async () => {
    const calls = stubFetch(() => new Response('<html>the ad</html>'));
    expect(await (await fetchOutbound(AD)).text()).toBe('<html>the ad</html>');
    expect(calls).toEqual([AD]);
  });

  it('a run knows which pages came through ScrapingAnt', async () => {
    stubFetch(challenge, () => viaAnt('<html>the list</html>'));
    expect(await fetchPage(AD)).toEqual({ text: '<html>the list</html>', proxied: true });
    stubFetch(() => new Response('<html>the list</html>'));
    expect(await fetchPage(AD)).toEqual({ text: '<html>the list</html>', proxied: false });
  });

  it('without a key, the refusal stays the answer', async () => {
    vi.stubEnv('SCRAPINGANT_API_KEY', '');
    const calls = stubFetch(challenge);
    expect((await fetchOutbound(AD)).status).toBe(403);
    expect(calls).toHaveLength(1);
  });

  it("another board's refusal isn't sent to ScrapingAnt", async () => {
    const calls = stubFetch(challenge);
    expect((await fetchOutbound('https://justjoin.it/job-offer/x')).status).toBe(403);
    expect(calls).toHaveLength(1);
  });

  it('a page its proxy is refused too fails, saying so', async () => {
    stubFetch(challenge, () => viaAnt('<title>Just a moment...</title>', 403));
    await expect(fetchOutbound(AD)).rejects.toThrow('HTTP 403 through ScrapingAnt too');
  });

  it("ScrapingAnt's own error is told in its words, never with the key", async () => {
    stubFetch(challenge, () => Response.json({ detail: 'Not enough API credits' }, { status: 403 }));
    const error = await fetchOutbound(AD).catch((caught: unknown) => caught as Error);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe('ScrapingAnt 403: Not enough API credits');
    expect((error as Error).message).not.toContain(KEY);
  });

  it('busy (the free plan: one request at a time) is asked again after a pause', async () => {
    vi.useFakeTimers();
    const calls = stubFetch(
      challenge,
      () => Response.json({ detail: 'Free user concurrency limit' }, { status: 409 }),
      () => viaAnt('<html>the ad</html>'),
    );
    const res = fetchOutbound(AD);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(await (await res).text()).toBe('<html>the ad</html>');
    expect(calls.filter(isAnt)).toHaveLength(2);
  });

  it('pages go to ScrapingAnt one after another', async () => {
    let out = 0;
    let most = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: unknown) => {
        if (!isAnt(input)) return challenge();
        most = Math.max(most, ++out);
        await new Promise((resolve) => setTimeout(resolve, 5));
        out--;
        return viaAnt('<html>an ad</html>');
      }),
    );
    const pages = await Promise.all([1, 2, 3].map((page) => fetchOutbound(`${AD}-${page}`)));
    expect(pages.map((res) => res.status)).toEqual([200, 200, 200]);
    expect(most).toBe(1);
  });
});
