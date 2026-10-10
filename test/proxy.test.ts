// the docs call it unstable_doesProxyMatch; this Next.js still exports it under its old name
import { unstable_doesMiddlewareMatch } from 'next/experimental/testing/server';
import { describe, expect, it } from 'vitest';
import nextConfig from '@/next.config';
import { config } from '@/proxy';

// Which requests proxy.ts sees (and so need the login cookie): everything but what's public.
const guarded = (url: string) => unstable_doesMiddlewareMatch({ config, nextConfig, url });

describe('the proxy matcher', () => {
  it('lets through what installing the app and showing notifications need, without the cookie', () => {
    for (const url of [
      '/manifest.webmanifest',
      '/sw.js',
      '/icons/icon-192.png',
      '/icons/maskable-512.png',
      '/icons/badge-96.png',
      '/icons/icon.svg',
    ])
      expect(guarded(url), url).toBe(false);
  });

  it('and, as before, the login page, the machines’ endpoints and Next’s assets', () => {
    for (const url of ['/login', '/api/cron/scrape', '/api/telegram', '/_next/static/chunks/a.js', '/favicon.ico'])
      expect(guarded(url), url).toBe(false);
  });

  it('guards everything else', () => {
    for (const url of [
      '/',
      '/?new=1',
      '/ai',
      '/settings',
      '/activity',
      '/applied',
      '/api/scrape',
      '/api/health',
      '/api/import',
      '/api/changes',
      '/sw.js.map',
      '/sw.jsx',
      '/manifest.webmanifest.bak',
      '/icons',
      '/iconsettings',
    ])
      expect(guarded(url), url).toBe(true);
  });
});
