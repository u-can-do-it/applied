import type { LookupAddress } from 'node:dns';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from '@/lib/ads/fetch';
import { fetchPage } from '@/lib/listings/pipeline/fetch';
import {
  checkedLookup,
  checkUrl,
  fetchOutbound,
  isBlockedAddress,
  MAX_BYTES,
  MAX_REDIRECTS,
  readText,
} from '@/lib/outbound';

// DNS is answered here: each name resolves to what `zone` says, nothing goes to a resolver.
const zone = new Map<string, string[]>();
const answer = (hostname: string): LookupAddress[] =>
  (zone.get(hostname) ?? []).map((address) => ({ address, family: address.includes(':') ? 6 : 4 }));
const resolved: string[] = [];
/** what the connection's own lookup gets instead, where set (a rebinding name) */
const atConnect = new Map<string, string[]>();

vi.mock('node:dns', () => {
  const notFound = (hostname: string) =>
    Object.assign(new Error(`getaddrinfo ENOTFOUND ${hostname}`), { code: 'ENOTFOUND' });
  const promisesLookup = (hostname: string) => {
    resolved.push(hostname);
    const addresses = answer(hostname);
    return addresses.length ? Promise.resolve(addresses) : Promise.reject(notFound(hostname));
  };
  const lookup = (
    hostname: string,
    _options: unknown,
    callback: (error: Error | null, addresses: LookupAddress[]) => void,
  ) => {
    const addresses = atConnect.has(hostname)
      ? (atConnect.get(hostname) ?? []).map((address) => ({ address, family: 4 }))
      : answer(hostname);
    queueMicrotask(() => callback(addresses.length ? null : notFound(hostname), addresses));
  };
  const dns = { lookup, promises: { lookup: promisesLookup } };
  return { default: dns, ...dns };
});

// production: the env is read (and kept) on first use, so this file stays in production
beforeAll(() => {
  vi.stubEnv('NODE_ENV', 'production');
});
beforeEach(() => {
  zone.clear();
  atConnect.clear();
  resolved.length = 0;
  zone.set('justjoin.it', ['104.18.20.1', '2606:4700::6812:1401']);
  zone.set('board.test', ['93.184.216.34']);
  zone.set('other.test', ['93.184.216.35']);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('isBlockedAddress', () => {
  it.each([
    '127.0.0.1',
    '127.255.0.9',
    '10.1.2.3',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.1',
    '169.254.169.254', // the cloud metadata service
    '100.64.0.1', // carrier-grade NAT
    '0.0.0.0',
    '224.0.0.1', // multicast
    '255.255.255.255',
    '::',
    '::1',
    '[::1]',
    'fe80::1',
    'fe80::1%eth0',
    'fd12:3456::1',
    'fc00::1',
    'ff02::1',
    '::ffff:127.0.0.1', // IPv4-mapped
    '::ffff:7f00:1',
    '::ffff:a9fe:a9fe', // 169.254.169.254, mapped
    '0:0:0:0:0:ffff:0a00:0001',
    '::7f00:1', // IPv4-compatible
    '::10.0.0.1',
    '64:ff9b::a9fe:a9fe', // NAT64 of the metadata service
    '2002:7f00:1::', // 6to4 of 127.0.0.1
    '2001:0:4136:e378:8000:63bf:3fff:fdd2', // Teredo
    '64:ff9b:1::a00:1', // local-use NAT64
    '64:ff9b:1:abcd::1',
    '::ffff:0:7f00:1', // IPv4-translated 127.0.0.1
    '::ffff:0:10.0.0.1',
    '::ffff:0:a9fe:a9fe',
  ])('blocks %s', (address) => {
    expect(isBlockedAddress(address)).toBe(true);
  });

  it.each([
    '93.184.216.34',
    '172.32.0.1',
    '100.128.0.1',
    '8.8.8.8',
    '2606:4700::6812:1401',
    '::ffff:8.8.8.8',
    '::ffff:0:8.8.8.8',
    '64:ff9b::808:808', // well-known NAT64 of 8.8.8.8
    '2002:808:808::',
  ])('lets %s through', (address) => {
    expect(isBlockedAddress(address)).toBe(false);
  });

  it('is false for anything that is not an address', () => {
    expect(isBlockedAddress('justjoin.it')).toBe(false);
  });
});

describe('checkUrl', () => {
  it('only http(s) links', async () => {
    await expect(checkUrl('ftp://justjoin.it/file')).rejects.toThrow('Only http and https links');
    await expect(checkUrl('file:///etc/passwd')).rejects.toThrow('Only http and https links');
    await expect(checkUrl('not a link')).rejects.toThrow('Not a link');
    await expect(checkUrl('https://justjoin.it/job-offer/x')).resolves.toBeInstanceOf(URL);
  });

  it.each([
    'http://localhost:3000/',
    'http://LOCALHOST./',
    'http://app.localhost/',
    'http://127.0.0.1/',
    'http://10.0.0.5/',
    'http://192.168.1.1/',
    'http://172.16.0.1/',
    'http://169.254.169.254/latest/meta-data',
    'http://2130706433/', // 127.0.0.1 in decimal
    'http://0x7f.0.0.1/', // hex
    'http://0177.0.0.1/', // octal
    'http://127.1/', // short form
    'http://0/',
    'http://[::1]/',
    'http://[::]/',
    'http://[fe80::1]/',
    'http://[::ffff:7f00:1]/',
    'http://[::ffff:127.0.0.1]/',
    'http://[0:0:0:0:0:ffff:a9fe:a9fe]/',
    'http://[fd00::1]:8080/',
  ])("refuses the server's own network: %s", async (link) => {
    await expect(checkUrl(link)).rejects.toThrow('Private addresses are not allowed');
    expect(resolved).toEqual([]); // an address or localhost: refused without asking DNS
  });

  it('resolves a name and refuses it if any of its addresses is private', async () => {
    zone.set('rebind.test', ['93.184.216.34', '127.0.0.1']);
    zone.set('mapped.test', ['::ffff:10.0.0.1']);
    zone.set('metadata.google.internal', ['169.254.169.254']);
    await expect(checkUrl('https://rebind.test/')).rejects.toThrow('Private addresses are not allowed');
    await expect(checkUrl('https://mapped.test/')).rejects.toThrow('Private addresses are not allowed');
    await expect(checkUrl('http://metadata.google.internal/')).rejects.toThrow('Private addresses are not allowed');
    await expect(checkUrl('https://justjoin.it/')).resolves.toBeInstanceOf(URL);
    expect(resolved).toEqual(['rebind.test', 'mapped.test', 'metadata.google.internal', 'justjoin.it']);
  });

  it("says so when a name doesn't resolve", async () => {
    await expect(checkUrl('https://nowhere.test/')).rejects.toThrow("Can't find nowhere.test (DNS)");
  });

  it('lets public addresses through, written any way', async () => {
    await expect(checkUrl('http://93.184.216.34/')).resolves.toBeInstanceOf(URL);
    await expect(checkUrl('http://172.32.0.1/')).resolves.toBeInstanceOf(URL);
    await expect(checkUrl('http://[2606:4700::6812:1401]/')).resolves.toBeInstanceOf(URL);
  });
});

describe("the connection's own lookup (DNS rebinding)", () => {
  const lookUp = (hostname: string, all: boolean) =>
    new Promise<{ error: Error | null; address: unknown; family?: number }>((resolve) => {
      checkedLookup(hostname, { all }, (error, address, family) => {
        resolve({ error, address, family });
      });
    });

  it('refuses a name that now answers a private address', async () => {
    zone.set('rebind.test', ['10.0.0.7']);
    const { error } = await lookUp('rebind.test', true);
    expect(error?.message).toBe('Private addresses are not allowed');
  });

  it('answers the checked addresses, as a list or the first one', async () => {
    expect(await lookUp('justjoin.it', true)).toMatchObject({ error: null, address: answer('justjoin.it') });
    expect(await lookUp('board.test', false)).toMatchObject({ error: null, address: '93.184.216.34', family: 4 });
  });
});

describe('a real request to a rebinding name', () => {
  it('is refused at connect time, when the name answers a private address the second time', async () => {
    const requests: string[] = [];
    const server = createServer((request, response) => {
      requests.push(request.url ?? '');
      response.end('internal');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const { port } = server.address() as AddressInfo;
      zone.set('rebind.test', ['93.184.216.34']); // what the check sees
      atConnect.set('rebind.test', ['127.0.0.1']); // what the connection would get
      await expect(fetchOutbound(`http://rebind.test:${port}/admin`)).rejects.toThrow(
        'Private addresses are not allowed',
      );
      expect(requests).toEqual([]);
    } finally {
      server.close();
    }
  });
});

describe('fetchOutbound', () => {
  const redirect = (location: string, status = 302) => new Response(null, { status, headers: { location } });

  it('follows redirects itself, checking every hop', async () => {
    zone.set('evil.test', ['93.184.216.36']);
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(redirect('https://other.test/job'))
      .mockResolvedValueOnce(redirect('http://169.254.169.254/latest/meta-data'));
    vi.stubGlobal('fetch', fetch);
    await expect(fetchOutbound('https://board.test/start')).rejects.toThrow('Private addresses are not allowed');
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls.map(([url]) => url as string)).toEqual([
      'https://board.test/start',
      'https://other.test/job',
    ]);
    for (const [, init] of fetch.mock.calls) expect(init).toMatchObject({ redirect: 'manual' });
  });

  it('refuses a redirect to a name that resolves privately', async () => {
    zone.set('inside.test', ['192.168.0.10']);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce(redirect('/x', 301)).mockResolvedValueOnce(redirect('https://inside.test/')),
    );
    await expect(fetchOutbound('https://board.test/')).rejects.toThrow('Private addresses are not allowed');
  });

  it('answers the final response, relative redirects resolved against the hop', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(redirect('/next', 307))
      .mockResolvedValueOnce(new Response('the ad', { status: 200 }));
    vi.stubGlobal('fetch', fetch);
    const res = await fetchOutbound('https://board.test/a/b');
    expect(await res.text()).toBe('the ad');
    expect(fetch.mock.calls[1][0]).toBe('https://board.test/next');
  });

  it(`stops after ${MAX_REDIRECTS} redirects`, async () => {
    const fetch = vi.fn(() => Promise.resolve(redirect('https://board.test/again')));
    vi.stubGlobal('fetch', fetch);
    await expect(fetchOutbound('https://board.test/')).rejects.toThrow(`More than ${MAX_REDIRECTS} redirects`);
    expect(fetch).toHaveBeenCalledTimes(MAX_REDIRECTS + 1);
  });

  it("sends a scraper's own headers only to its own site: on another, just the browser's", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(redirect('https://board.test/same'))
      .mockResolvedValueOnce(redirect('https://other.test/'))
      .mockResolvedValueOnce(redirect('https://board.test/back'))
      .mockResolvedValueOnce(new Response('ok'));
    vi.stubGlobal('fetch', fetch);
    await fetchOutbound('https://board.test/', {
      headers: {
        Authorization: 'Bearer abc',
        'X-Api-Key': 'k',
        Cookie: 'sid=1',
        'User-Agent': 'UA',
        Accept: 'text/html',
        'Accept-Language': 'pl',
      },
    });
    const sent = fetch.mock.calls.map(([, init]) => new Headers((init as RequestInit).headers));
    const header = (name: string) => sent.map((headers) => headers.get(name));
    expect(header('authorization')).toEqual(['Bearer abc', 'Bearer abc', null, null]);
    expect(header('x-api-key')).toEqual(['k', 'k', null, null]); // and not back either
    expect(header('cookie')).toEqual(['sid=1', 'sid=1', null, null]);
    expect(header('user-agent')).toEqual(['UA', 'UA', 'UA', 'UA']);
    expect(header('accept')).toEqual(['text/html', 'text/html', 'text/html', 'text/html']);
    expect(header('accept-language')).toEqual(['pl', 'pl', 'pl', 'pl']);
  });

  it('connects only through the checking lookup in production', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(new Response('ok'));
    vi.stubGlobal('fetch', fetch);
    await fetchOutbound('https://board.test/');
    expect((fetch.mock.calls[0][1] as { dispatcher?: unknown }).dispatcher).toBeDefined();
  });
});

describe('every outbound request goes through the check', () => {
  const redirect = (location: string) => new Response(null, { status: 302, headers: { location } });

  it("an ad's request", async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    await expect(get('http://169.254.169.254/latest/meta-data')).rejects.toThrow('Private addresses are not allowed');
    expect(fetch).not.toHaveBeenCalled();
  });

  it("a listing page's request, redirected inside", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(redirect('http://[::ffff:7f00:1]:8080/admin'));
    vi.stubGlobal('fetch', fetch);
    await expect(fetchPage('https://board.test/jobs')).rejects.toThrow('Private addresses are not allowed');
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe('fetchPage: a refused request', () => {
  const answer = (status: number, body: string, type: string) =>
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce(new Response(body, { status, headers: { 'content-type': type } })),
    );

  it("says the API's own reason when it answers JSON", async () => {
    answer(401, '{"exception":"AUTH_FAIL","display":"Authorisation failed"}', 'application/json; charset=utf8');
    await expect(fetchPage('https://board.test/api')).rejects.toThrow(/^HTTP 401, message: Authorisation failed$/);
    answer(429, '{"error":{"message":"Too many requests"}}', 'application/json');
    await expect(fetchPage('https://board.test/api')).rejects.toThrow(
      'HTTP 429, message: Too many requests (the site blocks this server?)',
    );
  });

  it("an error page's title or heading, without its code, and a plain-text answer", async () => {
    answer(
      503,
      '<html><head><title>503 Service Temporarily Unavailable</title></head><body><h1>503 Service Temporarily Unavailable</h1><hr>nginx</body></html>',
      'text/html',
    );
    await expect(fetchPage('https://board.test/api')).rejects.toThrow(
      /^HTTP 503, message: Service Temporarily Unavailable$/,
    );
    answer(502, '<body><h1>Bad &amp; gone</h1><p>Lots of text</p></body>', 'text/html');
    await expect(fetchPage('https://board.test/api')).rejects.toThrow(/^HTTP 502, message: Bad & gone$/);
    answer(503, '  upstream connect error\n', 'text/plain');
    await expect(fetchPage('https://board.test/api')).rejects.toThrow(/^HTTP 503, message: upstream connect error$/);
  });

  it("the status's own words when the site says nothing", async () => {
    answer(500, '<html>Oops</html>', 'text/html');
    await expect(fetchPage('https://board.test/jobs')).rejects.toThrow(/^HTTP 500 Internal Server Error$/);
    answer(503, '', 'application/octet-stream');
    await expect(fetchPage('https://board.test/api')).rejects.toThrow(/^HTTP 503 Service Unavailable$/);
  });
});

describe('readText: the body, capped', () => {
  const streamOf = (chunks: number, size: number) => {
    let sent = 0;
    return new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent++ < chunks) controller.enqueue(new Uint8Array(size).fill(97));
        else controller.close();
      },
    });
  };

  it('reads up to the limit, and stops reading past it', async () => {
    expect(await readText(new Response(streamOf(4, 10)), 40)).toBe('a'.repeat(40));
    const body = streamOf(1000, 1024 * 1024); // 1 GB, never read to the end
    await expect(readText(new Response(body), MAX_BYTES)).rejects.toThrow('The page is bigger than 8 MB');
  });

  it("decodes with the response's charset", async () => {
    const latin2 = new Uint8Array([0x50, 0xb3, 0xf3, 0x64, 0xbc]); // "Płódź" in ISO-8859-2
    const res = new Response(latin2, { headers: { 'content-type': 'text/html; charset=ISO-8859-2' } });
    expect(await readText(res)).toBe('Płódź');
    expect(await readText(new Response(null))).toBe('');
  });

  it('caps an ad\'s or a typed link\'s page too ("Add application")', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response(streamOf(9, 1024 * 1024))));
    await expect(get('https://board.test/job/1')).rejects.toThrow('The page is bigger than 8 MB');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(Response.json({ title: 'Dev' })));
    expect(await (await get('https://board.test/api/1')).json()).toEqual({ title: 'Dev' });
  });
});
