import https from 'node:https';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import webpush from 'web-push';
import { checkedLookup } from '@/lib/outbound';
import { pushAgent, sendPush } from '@/lib/push';

// In production a push connects only to an address the SSRF guard lets through: web-push gets an
// https.Agent whose lookup is lib/outbound.ts's checkedLookup. (A file of its own: in production
// lib/env.ts reads the environment once.)

vi.mock('web-push', () => ({ default: { sendNotification: vi.fn() } }));
vi.mock('@/lib/db/repos/push-subscriptions', () => ({ list: vi.fn(), remove: vi.fn() }));
const send = vi.mocked(webpush.sendNotification);

beforeAll(() => {
  vi.stubEnv('NODE_ENV', 'production');
  vi.stubEnv('VAPID_PUBLIC_KEY', `B${'p'.repeat(86)}`);
  vi.stubEnv('VAPID_PRIVATE_KEY', 'q'.repeat(43));
  vi.stubEnv('VAPID_SUBJECT', 'mailto:me@example.com');
});
afterAll(() => vi.unstubAllEnvs());

it('sends through an agent that checks the addresses it connects to', async () => {
  send.mockResolvedValue({ statusCode: 201, body: '', headers: {} });
  const device = {
    endpoint: 'https://fcm.googleapis.com/fcm/send/a',
    p256dh: `B${'k'.repeat(86)}`,
    auth: 'a'.repeat(22),
  };
  expect(await sendPush({ title: 't', body: 'b', url: '/' }, [device])).toMatchObject({ delivered: 1 });
  const agent = send.mock.calls[0][2]?.agent;
  expect(agent).toBeInstanceOf(https.Agent);
  expect(agent).toBe(pushAgent());
  expect((agent as https.Agent & { options: https.AgentOptions }).options.lookup).toBe(checkedLookup);
});

it('the agent refuses a private address at connect time', async () => {
  const lookup = (pushAgent() as https.Agent & { options: https.AgentOptions }).options.lookup;
  const answer = await new Promise<NodeJS.ErrnoException | null>((resolve) => {
    lookup?.('localhost', {}, (error) => resolve(error));
  });
  expect(answer?.code).toBe('EPRIVATE');
});
