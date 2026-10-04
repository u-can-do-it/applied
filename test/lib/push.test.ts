import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import webpush from 'web-push';
import * as pushRepo from '@/lib/db/repos/push-subscriptions';
import { pushConfigured, pushProblem, sendPush, vapidPublicKey } from '@/lib/push';

// Sending with web-push mocked: no push service is called. A subscription the push service says is
// gone (404, 410) is removed; other failures are counted and logged, and the subscription stays.

vi.mock('web-push', () => ({ default: { sendNotification: vi.fn() } }));
vi.mock('@/lib/db/repos/push-subscriptions', () => ({ list: vi.fn(), remove: vi.fn() }));
const send = vi.mocked(webpush.sendNotification);
const list = vi.mocked(pushRepo.list);
const remove = vi.mocked(pushRepo.remove);

const PUBLIC_KEY = `B${'p'.repeat(86)}`;
const PRIVATE_KEY = 'q'.repeat(43);
const device = (name: string) => ({
  endpoint: `https://fcm.googleapis.com/fcm/send/${name}`,
  p256dh: `B${'k'.repeat(86)}`,
  auth: 'a'.repeat(22),
});
/** what web-push throws when the push service answers with an error */
const answered = (statusCode: number) =>
  Object.assign(new Error('Received unexpected response code'), { statusCode, body: '', headers: {} });
const payload = { title: '2 new offers', body: 'React @ Acme, Vue @ Beta', url: '/?new=1' };

beforeEach(() => {
  vi.stubEnv('VAPID_PUBLIC_KEY', PUBLIC_KEY);
  vi.stubEnv('VAPID_PRIVATE_KEY', PRIVATE_KEY);
  vi.stubEnv('VAPID_SUBJECT', 'mailto:me@example.com');
  send.mockReset();
  send.mockResolvedValue({ statusCode: 201, body: '', headers: {} });
  list.mockReset();
  remove.mockReset();
  remove.mockResolvedValue(undefined);
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('sendPush', () => {
  it('sends the payload to every subscribed device, encrypted with its keys and signed with the VAPID keys', async () => {
    list.mockResolvedValue([device('a'), device('b')]);
    expect(await sendPush(payload)).toEqual({ delivered: 2, removed: 0, failed: 0 });
    expect(send).toHaveBeenCalledTimes(2);
    const [subscription, body, options] = send.mock.calls[0];
    expect(subscription).toEqual({
      endpoint: device('a').endpoint,
      keys: { p256dh: device('a').p256dh, auth: 'a'.repeat(22) },
    });
    expect(JSON.parse(body as string)).toEqual(payload);
    expect(options).toMatchObject({
      vapidDetails: { subject: 'mailto:me@example.com', publicKey: PUBLIC_KEY, privateKey: PRIVATE_KEY },
      timeout: 10_000,
    });
  });

  it.each([404, 410])('removes a subscription the push service answers %i for', async (status) => {
    list.mockResolvedValue([device('gone'), device('fine')]);
    send.mockImplementation((subscription) =>
      subscription.endpoint.endsWith('/gone')
        ? Promise.reject(answered(status))
        : Promise.resolve({ statusCode: 201, body: '', headers: {} }),
    );
    expect(await sendPush(payload)).toEqual({ delivered: 1, removed: 1, failed: 0 });
    expect(remove).toHaveBeenCalledExactlyOnceWith(device('gone').endpoint);
  });

  it('keeps a subscription that failed otherwise, and says why', async () => {
    list.mockResolvedValue([device('a')]);
    send.mockRejectedValue(answered(500));
    expect(await sendPush(payload)).toEqual({
      delivered: 0,
      removed: 0,
      failed: 1,
      error: 'Push: the push service answered 500',
    });
    expect(remove).not.toHaveBeenCalled();
  });

  it('a network error: the user sees a plain message, the log the details', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    for (const code of ['getaddrinfo ENOTFOUND fcm.googleapis.com', 'connect ECONNREFUSED 10.0.0.1:443']) {
      send.mockRejectedValue(new Error(code));
      expect((await sendPush(payload, [device('a')])).error).toBe('Push: the push service couldn’t be reached');
      expect(JSON.parse(String(warn.mock.lastCall?.[0]))).toMatchObject({ error: code });
    }
  });

  it('gives up on a push service that doesn’t answer', async () => {
    vi.useFakeTimers();
    send.mockReturnValue(new Promise(() => {}));
    const sending = sendPush(payload, [device('slow')]);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await sending).toEqual({
      delivered: 0,
      removed: 0,
      failed: 1,
      error: 'Push: the push service didn’t answer in time',
    });
  });

  it.each([
    'http://fcm.googleapis.com/fcm/send/a',
    'https://169.254.169.254/latest/meta-data',
    'https://10.0.0.1/push',
    'https://push.example/a',
    'https://fcm.googleapis.com:8443/fcm/send/a',
  ])('never sends to %s, not a push service’s https URL: it is deleted', async (endpoint) => {
    expect(await sendPush(payload, [{ ...device('a'), endpoint }])).toEqual({ delivered: 0, removed: 1, failed: 0 });
    expect(send).not.toHaveBeenCalled();
    expect(remove).toHaveBeenCalledWith(endpoint);
  });

  it('outside production, no agent of its own (a dev server, the tests)', async () => {
    await sendPush(payload, [device('a')]);
    expect(send.mock.calls[0][2]).not.toHaveProperty('agent');
  });

  it('logs neither the endpoint nor the keys', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    send.mockRejectedValue(answered(500));
    await sendPush(payload, [device('secret-device-id')]);
    const line = String(warn.mock.calls[0][0]);
    expect(JSON.parse(line)).toMatchObject({ msg: 'Push: sending failed', pushService: 'fcm.googleapis.com' });
    expect(line).not.toContain('secret-device-id');
    expect(line).not.toContain('k'.repeat(20));
    expect(line).not.toContain(PRIVATE_KEY);
  });

  it('does nothing without the VAPID keys', async () => {
    vi.stubEnv('VAPID_PRIVATE_KEY', '');
    expect(await sendPush(payload, [device('a')])).toMatchObject({
      delivered: 0,
      error: 'Push isn’t set up (VAPID keys).',
    });
    expect(send).not.toHaveBeenCalled();
  });
});

describe('push configuration', () => {
  it('is on with all three variables, and the public key is given to the browser', () => {
    expect(pushConfigured()).toBe(true);
    expect(vapidPublicKey()).toBe(PUBLIC_KEY);
    expect(pushProblem()).toBeNull();
  });

  it('says what is missing or malformed', () => {
    vi.stubEnv('VAPID_SUBJECT', '');
    expect(pushConfigured()).toBe(false);
    expect(vapidPublicKey()).toBeNull();
    expect(pushProblem()).toBe('VAPID_SUBJECT not set');
    vi.stubEnv('VAPID_SUBJECT', 'me@example.com');
    expect(pushProblem()).toBe('VAPID_SUBJECT is not a mailto: address or an https:// URL');
    vi.stubEnv('VAPID_SUBJECT', '');
    vi.stubEnv('VAPID_PUBLIC_KEY', '');
    vi.stubEnv('VAPID_PRIVATE_KEY', '');
    expect(pushProblem()).toBe('not set');
  });
});
