import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as pushRepo from '@/lib/db/repos/push-subscriptions';
import { notify } from '@/lib/listings/pipeline/notify';
import { pushConfigured, sendPush } from '@/lib/push';
import {
  pushSubscribeAction,
  pushTestAction,
  pushUnsubscribeAction,
  sendQueueAction,
  setMutedAction,
} from '@/features/notifications/actions';
import { isPushEndpoint } from '@/lib/shared/schemas/push';

// The Notifications panel's actions: a browser's subscription is checked (zod/mini) before it's saved,
// since the server will send to it.

vi.mock('@/server/session', () => ({ requireLogin: vi.fn(() => Promise.resolve()) }));
vi.mock('next/cache', () => ({ refresh: vi.fn() }));
vi.mock('next/headers', () => ({
  headers: () => Promise.resolve(new Headers({ 'user-agent': 'Mozilla/5.0 (Linux; Android 15) Chrome/140' })),
}));
vi.mock('@/lib/db/repos/push-subscriptions', () => ({ save: vi.fn(), remove: vi.fn(), get: vi.fn() }));
vi.mock('@/lib/push', () => ({ pushConfigured: vi.fn(), sendPush: vi.fn() }));
vi.mock('@/lib/listings/pipeline/notify', () => ({ notify: vi.fn() }));
vi.mock('@/lib/db/repos/scrape-settings', () => ({}));
vi.mock('@/lib/db/repos/scrape-state', () => ({ setMuted: vi.fn() }));

const save = vi.mocked(pushRepo.save);
const BAD = 'This browser’s push subscription doesn’t look right.';
const UNKNOWN = 'This browser’s push service isn’t one Jobwatch sends to (Chrome, Firefox, Edge, Safari).';
const subscription = {
  endpoint: 'https://fcm.googleapis.com/fcm/send/abc:def',
  expirationTime: null,
  keys: { p256dh: `B${'x'.repeat(86)}`, auth: 'y'.repeat(22) },
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(pushConfigured).mockReturnValue(true);
});

describe('isPushEndpoint: only the known push services, https, default port', () => {
  it.each([
    'https://fcm.googleapis.com/fcm/send/abc:def',
    'https://updates.push.services.mozilla.com/wpush/v2/abc',
    'https://wns2-par02p.notify.windows.com/w/?token=abc',
    'https://web.push.apple.com/QGuQ',
    'https://fcm.googleapis.com:443/fcm/send/a', // the default port, spelt out
  ])('takes %s', (url) => {
    expect(isPushEndpoint(url)).toBe(true);
  });

  it.each([
    'http://fcm.googleapis.com/fcm/send/a',
    'https://fcm.googleapis.com:8443/fcm/send/a',
    'https://fcm.googleapis.com.evil.example/a',
    'https://evil.example/fcm.googleapis.com',
    'https://notify.windows.com/a',
    'https://user:pw@fcm.googleapis.com/a',
    'https://localhost/a',
    'https://10.0.0.1/a',
    'https://[::1]/a',
    'not a url',
  ])('refuses %s', (url) => {
    expect(isPushEndpoint(url)).toBe(false);
  });
});

describe('pushSubscribeAction', () => {
  it('saves a well-formed subscription, with the device it came from', async () => {
    expect(await pushSubscribeAction(subscription)).toEqual({
      ok: true,
      data: 'Notifications are on for this device.',
    });
    expect(save).toHaveBeenCalledExactlyOnceWith({
      endpoint: subscription.endpoint,
      p256dh: subscription.keys.p256dh,
      auth: subscription.keys.auth,
      userAgent: 'Mozilla/5.0 (Linux; Android 15) Chrome/140',
    });
  });

  it.each([
    ['an http endpoint', { ...subscription, endpoint: 'http://fcm.googleapis.com/fcm/send/a' }, UNKNOWN],
    ['an endpoint that isn’t a URL', { ...subscription, endpoint: 'push.example' }, UNKNOWN],
    ['a private address', { ...subscription, endpoint: 'https://127.0.0.1/push' }, UNKNOWN],
    ['the cloud metadata service', { ...subscription, endpoint: 'https://169.254.169.254/latest' }, UNKNOWN],
    ['a host that isn’t a push service', { ...subscription, endpoint: 'https://push.example/a' }, UNKNOWN],
    ['no keys', { endpoint: subscription.endpoint }, BAD],
    [
      'a key that isn’t base64url',
      { ...subscription, keys: { ...subscription.keys, auth: 'y'.repeat(20) + '/+' } },
      BAD,
    ],
    ['a key too short', { ...subscription, keys: { ...subscription.keys, p256dh: 'B'.repeat(10) } }, BAD],
    ['a key too long', { ...subscription, keys: { ...subscription.keys, auth: 'y'.repeat(200) } }, BAD],
    ['an endpoint too long', { ...subscription, endpoint: `https://fcm.googleapis.com/${'a'.repeat(3000)}` }, BAD],
  ])('refuses %s', async (_, input, error) => {
    expect(await pushSubscribeAction(input as typeof subscription)).toEqual({ ok: false, error });
    expect(save).not.toHaveBeenCalled();
  });

  it('refuses while push isn’t set up on the server', async () => {
    vi.mocked(pushConfigured).mockReturnValue(false);
    expect(await pushSubscribeAction(subscription)).toEqual({
      ok: false,
      error: 'Push isn’t set up on the server: VAPID keys are missing.',
    });
    expect(save).not.toHaveBeenCalled();
  });
});

describe('this device’s test and disable', () => {
  const device = { endpoint: subscription.endpoint, p256dh: subscription.keys.p256dh, auth: subscription.keys.auth };

  it('the test goes to this device only', async () => {
    vi.mocked(pushRepo.get).mockResolvedValue(device);
    vi.mocked(sendPush).mockResolvedValue({ delivered: 1, removed: 0, failed: 0 });
    expect(await pushTestAction({ endpoint: device.endpoint })).toMatchObject({ ok: true });
    expect(vi.mocked(sendPush).mock.calls[0][1]).toEqual([device]);
  });

  it('says so when the push service says the subscription expired, or the server doesn’t have it', async () => {
    vi.mocked(pushRepo.get).mockResolvedValue(device);
    vi.mocked(sendPush).mockResolvedValue({ delivered: 0, removed: 1, failed: 0 });
    expect(await pushTestAction({ endpoint: device.endpoint })).toEqual({
      ok: false,
      error: 'The push service says this subscription expired: enable it again.',
    });
    vi.mocked(pushRepo.get).mockResolvedValue(null);
    expect((await pushTestAction({ endpoint: device.endpoint })).ok).toBe(false);
  });

  it('disabling removes it; an endpoint that isn’t https is refused', async () => {
    expect(await pushUnsubscribeAction({ endpoint: device.endpoint })).toMatchObject({ ok: true });
    expect(pushRepo.remove).toHaveBeenCalledWith(device.endpoint);
    expect(await pushUnsubscribeAction({ endpoint: 'javascript:alert(1)' })).toMatchObject({ ok: false });
  });
});

describe('sendQueueAction', () => {
  it('says when there is nothing to send it with', async () => {
    vi.mocked(notify).mockResolvedValue({ sent: 0, matched: null, noChannel: true });
    expect(await sendQueueAction()).toEqual({
      ok: false,
      error: 'Nothing to send it with: set up Telegram and switch it on, or enable notifications on a device.',
    });
    vi.mocked(notify).mockResolvedValue({ sent: 3, matched: null });
    expect(await sendQueueAction()).toEqual({ ok: true, data: 'Sent 3.' });
  });

  it('a channel failed but another sent: done, with a warning, not an error', async () => {
    vi.mocked(notify).mockResolvedValue({
      sent: 3,
      matched: null,
      warning: 'Push: the push service couldn’t be reached',
    });
    expect(await sendQueueAction()).toEqual({
      ok: true,
      data: { warning: 'Sent 3; Push: the push service couldn’t be reached' },
    });
  });
});

describe('setMutedAction', () => {
  it('unmuting sends what waited; a channel that failed while another sent is a warning', async () => {
    vi.mocked(notify).mockResolvedValue({ sent: 2, matched: null, warning: 'Telegram sendMessage: HTTP 500' });
    expect(await setMutedAction({ muted: false })).toEqual({
      ok: true,
      data: { warning: 'Unmuted, sent 2; Telegram sendMessage: HTTP 500' },
    });
    vi.mocked(notify).mockResolvedValue({ sent: 0, matched: null, error: 'Telegram sendMessage: HTTP 500' });
    expect(await setMutedAction({ muted: false })).toEqual({
      ok: false,
      error: 'Unmuted, but: Telegram sendMessage: HTTP 500',
    });
  });
});
