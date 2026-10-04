import { describe, expect, it, vi } from 'vitest';
import { activeChannels, deliver, type Batch, type Channel } from '@/lib/channels';
import type { Queued } from '@/lib/db/repos/notify-queue';

// The channel abstraction: every ready channel gets the same batch, at once; one failing doesn't stop
// the others, and only what no channel got to you goes back into the queue.

// the real channels' modules aren't used here: no Telegram, no push, no database
vi.mock('@/lib/channels/telegram', () => ({ telegramChannel: { name: 'Telegram' } }));
vi.mock('@/lib/channels/push', () => ({ pushChannel: { name: 'Push' } }));

let seq = 0;
const offer = (): Queued => {
  seq++;
  return {
    src: 'justjoin',
    id: `id-${seq}`,
    title: `Offer ${seq}`,
    company: 'Acme',
    seniority: null,
    remote: false,
    location: null,
    url: `https://x.test/${seq}`,
    jobId: `job-${seq}`,
  };
};
const batch = (overrides: Partial<Batch> = {}): Batch => ({
  matched: [offer(), offer()],
  unmatched: [offer()],
  unchecked: [],
  profile: null,
  held: false,
  ...overrides,
});
const channel = (name: string, send: Channel['send'], ready: Channel['ready'] = () => true) => ({
  name,
  ready: vi.fn(ready),
  send: vi.fn(send),
});

describe('deliver', () => {
  it('gives every channel the same batch, and nothing is unsent when all of them deliver', async () => {
    const telegram = channel('Telegram', () => Promise.resolve({ unsent: [] }));
    const push = channel('Push', () => Promise.resolve({ unsent: [] }));
    const sent = batch();
    expect(await deliver([telegram, push], sent)).toEqual({ unsent: [], errors: [] });
    expect(telegram.send).toHaveBeenCalledExactlyOnceWith(sent);
    expect(push.send).toHaveBeenCalledExactlyOnceWith(sent);
  });

  it('one failing doesn’t stop the other; what the other delivered isn’t sent again', async () => {
    const sent = batch();
    const telegram = channel('Telegram', (got) =>
      Promise.resolve({ unsent: got.matched, error: 'Telegram sendMessage: HTTP 500' }),
    );
    const push = channel('Push', () => Promise.resolve({ unsent: [] }));
    expect(await deliver([telegram, push], sent)).toEqual({ unsent: [], errors: ['Telegram sendMessage: HTTP 500'] });
    expect(push.send).toHaveBeenCalledOnce();
  });

  it('a channel that throws counts as having sent nothing; the others still send', async () => {
    const sent = batch();
    const telegram = channel('Telegram', () => Promise.resolve({ unsent: [] }));
    const push = channel('Push', () => Promise.reject(new Error('boom')));
    expect(await deliver([push, telegram], sent)).toEqual({ unsent: [], errors: ['Push: boom'] });
    expect(telegram.send).toHaveBeenCalledOnce();
  });

  it('puts back only what no channel got to you', async () => {
    const sent = batch();
    const [first, second] = sent.matched;
    const telegram = channel('Telegram', () => Promise.resolve({ unsent: [first, second], error: 'a' }));
    const push = channel('Push', () => Promise.resolve({ unsent: [second], error: 'b' }));
    expect(await deliver([telegram, push], sent)).toEqual({ unsent: [second], errors: ['a', 'b'] });
    // with one channel, what it couldn't send
    expect(await deliver([telegram], sent)).toEqual({ unsent: [first, second], errors: ['a'] });
  });

  it('sends at once, not one channel after the other', async () => {
    const order: string[] = [];
    const slow = channel('Telegram', async () => {
      order.push('telegram started');
      await new Promise((resolve) => setTimeout(resolve, 20));
      order.push('telegram done');
      return { unsent: [] };
    });
    const fast = channel('Push', () => {
      order.push('push started');
      return Promise.resolve({ unsent: [] });
    });
    await deliver([slow, fast], batch());
    expect(order).toEqual(['telegram started', 'push started', 'telegram done']);
  });
});

describe('activeChannels', () => {
  it('the ready ones; one that can’t tell (throws) isn’t', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const telegram = channel(
      'Telegram',
      () => Promise.resolve({ unsent: [] }),
      () => false,
    );
    const push = channel(
      'Push',
      () => Promise.resolve({ unsent: [] }),
      () => Promise.resolve(true),
    );
    const broken = channel(
      'Broken',
      () => Promise.resolve({ unsent: [] }),
      () => Promise.reject(new Error('no table')),
    );
    expect((await activeChannels([telegram, push, broken])).map((ready) => ready.name)).toEqual(['Push']);
  });
});
