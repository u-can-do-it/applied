import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { get } from '@/lib/ads/fetch';
import { checkUrl } from '@/lib/outbound';

// production: the env is read (and kept) on first use, so this file stays in production
beforeAll(() => {
  vi.stubEnv('NODE_ENV', 'production');
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('checkUrl', () => {
  it('only http(s) links', () => {
    expect(() => checkUrl('ftp://acme.test/file')).toThrow('Only http and https links');
    expect(() => checkUrl('not a link')).toThrow('Not a link');
    expect(() => checkUrl('https://justjoin.it/job-offer/x')).not.toThrow();
  });

  it("not the server's own network, in production", () => {
    for (const link of [
      'http://localhost:3000/',
      'http://127.0.0.1/',
      'http://10.0.0.5/',
      'http://192.168.1.1/',
      'http://172.16.0.1/',
      'http://169.254.169.254/latest/meta-data',
      'http://[::1]/',
      'http://metadata.google.internal/',
    ])
      expect(() => checkUrl(link), link).toThrow('Private addresses are not allowed');
    expect(() => checkUrl('http://172.32.0.1/')).not.toThrow();
  });
});

describe("an ad's request", () => {
  it('is checked before anything is sent', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    await expect(get('http://169.254.169.254/latest/meta-data')).rejects.toThrow('Private addresses are not allowed');
    expect(fetch).not.toHaveBeenCalled();
  });
});
