import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// public/sw.js run against a stand-in `self`: what a push shows, and where tapping it leads.

type Listener = (event: Record<string, unknown>) => void;
const ORIGIN = 'https://jobwatch.example';
const source = readFileSync(new URL('../../public/sw.js', import.meta.url), 'utf8');

function worker(windows: { url: string; navigate?: (url: string) => Promise<unknown> }[] = []) {
  const listeners = new Map<string, Listener>();
  const opened: string[] = [];
  const navigated: string[] = [];
  const clients = windows.map((client) => ({
    url: client.url,
    focus: vi.fn(function (this: unknown) {
      return Promise.resolve(this);
    }),
    navigate: vi.fn(
      client.navigate ??
        ((url: string) => {
          navigated.push(url);
          return Promise.resolve(null);
        }),
    ),
  }));
  const self = {
    location: new URL(`${ORIGIN}/sw.js`),
    addEventListener: (type: string, listener: Listener) => listeners.set(type, listener),
    skipWaiting: vi.fn(),
    registration: { showNotification: vi.fn(() => Promise.resolve()) },
    clients: {
      claim: vi.fn(() => Promise.resolve()),
      matchAll: vi.fn(() => Promise.resolve(clients)),
      openWindow: vi.fn((url: string) => {
        opened.push(url);
        return Promise.resolve(null);
      }),
    },
  };
  // the worker's own file, as the browser runs it, with this `self`
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const run = new Function('self', source) as (scope: typeof self) => void;
  run(self);
  /** dispatches an event and waits for what it handed to waitUntil */
  const dispatch = async (type: string, event: Record<string, unknown>) => {
    let work: Promise<unknown> = Promise.resolve();
    listeners.get(type)?.({ ...event, waitUntil: (promise: Promise<unknown>) => (work = promise) });
    await work;
  };
  return { self, dispatch, opened, navigated, clients };
}

const push = (data: string | null) => ({
  data: data === null ? null : { json: () => JSON.parse(data) as unknown, text: () => data },
});
const click = (url: unknown) => ({ notification: { close: vi.fn(), data: { url } } });

describe('public/sw.js', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('shows a push as a notification, with the app’s icons and where it leads', async () => {
    const { self, dispatch } = worker();
    await dispatch('push', push(JSON.stringify({ title: '3 new offers', body: 'React @ Acme', url: '/?new=1' })));
    expect(self.registration.showNotification).toHaveBeenCalledWith('3 new offers', {
      body: 'React @ Acme',
      icon: '/icons/icon-192.png',
      badge: '/icons/badge-96.png',
      data: { url: '/?new=1' },
    });
  });

  it('a push that isn’t JSON, or has nothing: still a notification', async () => {
    const { self, dispatch } = worker();
    await dispatch('push', push('plain text'));
    await dispatch('push', push(null));
    expect(self.registration.showNotification).toHaveBeenNthCalledWith(
      1,
      'Jobwatch',
      expect.objectContaining({ body: 'plain text' }),
    );
    expect(self.registration.showNotification).toHaveBeenNthCalledWith(
      2,
      'Jobwatch',
      expect.objectContaining({ body: '', data: { url: '/' } }),
    );
  });

  it('tapped with the app open: that window goes to the page and comes to the front', async () => {
    const { dispatch, navigated, opened, clients } = worker([{ url: `${ORIGIN}/settings` }]);
    await dispatch('notificationclick', click('/?new=1'));
    expect(navigated).toEqual([`${ORIGIN}/?new=1`]);
    expect(clients[0].focus).toHaveBeenCalled();
    expect(opened).toEqual([]);
  });

  it('tapped with the app closed, or a window it can’t navigate: a new window', async () => {
    const closed = worker();
    await closed.dispatch('notificationclick', click('/?new=1'));
    expect(closed.opened).toEqual([`${ORIGIN}/?new=1`]);
    const stuck = worker([{ url: `${ORIGIN}/`, navigate: () => Promise.reject(new TypeError('not controlled')) }]);
    await stuck.dispatch('notificationclick', click('/ai'));
    expect(stuck.opened).toEqual([`${ORIGIN}/ai`]);
  });

  it('never leads off the app', async () => {
    const { dispatch, opened } = worker();
    await dispatch('notificationclick', click('https://evil.example/phish'));
    await dispatch('notificationclick', click(42));
    expect(opened).toEqual([`${ORIGIN}/`, `${ORIGIN}/`]);
  });
});
