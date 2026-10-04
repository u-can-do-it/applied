import { beforeEach, describe, expect, it, vi } from 'vitest';
import { formatPush, NEW_OFFERS_PATH, pushChannel } from '@/lib/channels/push';
import type { Batch, Outgoing } from '@/lib/channels/types';
import { sendPush } from '@/lib/push';

vi.mock('@/lib/push', () => ({ sendPush: vi.fn(), pushConfigured: vi.fn(() => true) }));
vi.mock('@/lib/db/repos/push-subscriptions', () => ({ size: vi.fn(() => Promise.resolve(1)) }));
const send = vi.mocked(sendPush);

let seq = 0;
const offer = (title: string, company: string | null = 'Acme'): Outgoing => {
  seq++;
  return {
    src: 'justjoin',
    id: `${seq}`,
    title,
    company,
    seniority: null,
    remote: null,
    location: null,
    url: 'https://x.test',
    jobId: null,
  };
};
const batch = (overrides: Partial<Batch>): Batch => ({
  matched: [],
  unmatched: [],
  unchecked: [],
  profile: null,
  held: false,
  ...overrides,
});

describe('formatPush: one notification per batch', () => {
  it('nothing new: none', () => {
    expect(formatPush(batch({}))).toBeNull();
  });

  it('without the AI filter: how many, the first ones named, the rest counted', () => {
    const offers = ['React Senior', 'Vue Dev', 'Go Dev', 'Rust Dev', 'Java Dev', 'PHP Dev'].map((title) =>
      offer(title),
    );
    offers[1] = offer('Vue Dev', null);
    expect(formatPush(batch({ matched: offers }))).toEqual({
      title: '6 new offers',
      body: 'React Senior @ Acme, Vue Dev, Go Dev @ Acme, Rust Dev @ Acme, +2 more',
      url: NEW_OFFERS_PATH,
    });
    expect(formatPush(batch({ matched: [offer('React Senior')] }))?.title).toBe('1 new offer');
  });

  it('with the AI filter: the matches named, what the AI couldn’t check too, the rest counted', () => {
    expect(
      formatPush(batch({ profile: 'Me', matched: [offer('React Senior')], unmatched: [offer('PHP'), offer('Java')] })),
    ).toMatchObject({ title: '3 new offers, 1 matching “Me”', body: 'React Senior @ Acme' });
    expect(formatPush(batch({ profile: 'Me', unmatched: [offer('PHP'), offer('Java')] }))).toMatchObject({
      title: '2 new offers',
      body: 'None matched “Me”.',
    });
    expect(
      formatPush(batch({ profile: 'Me', unmatched: [offer('PHP')], unchecked: [offer('Go Dev')], held: true })),
    ).toMatchObject({
      title: '2 new offers',
      body: 'Not checked by the AI: Go Dev @ Acme\nHeld while muted.',
    });
  });
});

describe('the push channel', () => {
  beforeEach(() => send.mockReset());

  it('is ready with the VAPID keys and a subscribed device', async () => {
    expect(await pushChannel.ready()).toBe(true);
  });

  it('one device that got it is enough', async () => {
    send.mockResolvedValue({ delivered: 1, removed: 1, failed: 1, error: 'Push: the push service answered 500' });
    const sent = batch({ matched: [offer('React')] });
    expect(await pushChannel.send(sent)).toEqual({ unsent: [] });
    expect(send).toHaveBeenCalledExactlyOnceWith(formatPush(sent));
  });

  it('no device got it: everything is unsent, with why', async () => {
    send.mockResolvedValue({ delivered: 0, removed: 0, failed: 1, error: 'Push: the push service answered 500' });
    const sent = batch({ matched: [offer('React')], unmatched: [offer('PHP')] });
    expect(await pushChannel.send(sent)).toEqual({
      unsent: [...sent.matched, ...sent.unmatched],
      error: 'Push: the push service answered 500',
    });
    send.mockResolvedValue({ delivered: 0, removed: 1, failed: 0 });
    expect((await pushChannel.send(sent)).error).toBe('Push: no subscribed device got it.');
  });
});
