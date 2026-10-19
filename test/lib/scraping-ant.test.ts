import { afterEach, describe, expect, it, vi } from 'vitest';
import { throughScrapingAnt } from '@/lib/scraping-ant';

// ScrapingAnt answers 423 while the site sees through its datacenter proxies; a residential one gets through.
function stubScrapingAnt() {
  const proxies: string[] = [];
  vi.stubEnv('SCRAPINGANT_API_KEY', 'the-key');
  vi.stubGlobal(
    'fetch',
    vi.fn((api: URL) => {
      const proxy = api.searchParams.get('proxy_type') ?? '';
      proxies.push(proxy);
      return Promise.resolve(
        proxy === 'residential'
          ? new Response('<html>jobs</html>', { headers: { 'ant-page-status-code': '200' } })
          : new Response(JSON.stringify({ detail: 'Our browser was detected by target site.' }), { status: 423 }),
      );
    }),
  );
  return proxies;
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('throughScrapingAnt', () => {
  it("asks a residential proxy for Eldorado's search once three datacenter ones were seen through", async () => {
    const proxies = stubScrapingAnt();
    const res = await throughScrapingAnt('https://czyjesteldorado.pl/search?tag%5B%5D=React&sort=newest');
    expect(await res.text()).toBe('<html>jobs</html>');
    expect(proxies).toEqual(['datacenter', 'datacenter', 'datacenter', 'residential']);
  });

  it('keeps its ads on datacenter proxies, failing when every one is seen through', async () => {
    const proxies = stubScrapingAnt();
    await expect(throughScrapingAnt('https://czyjesteldorado.pl/praca/449389-scrum-master')).rejects.toThrow(
      /^ScrapingAnt 423: Our browser was detected/,
    );
    expect(new Set(proxies)).toEqual(new Set(['datacenter']));
    expect(proxies).toHaveLength(8);
  });

  it('keeps the other boards on datacenter proxies', async () => {
    const proxies = stubScrapingAnt();
    await expect(throughScrapingAnt('https://theprotocol.it/praca?kw=react&sort=date')).rejects.toThrow(/423/);
    expect(new Set(proxies)).toEqual(new Set(['datacenter']));
  });
});
