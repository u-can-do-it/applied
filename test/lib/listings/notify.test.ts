import { beforeEach, describe, expect, it, vi } from 'vitest';
import { assessJobs } from '@/lib/ai/runs';
import { activeChannels, deliver } from '@/lib/channels';
import * as queueRepo from '@/lib/db/repos/notify-queue';
import { notify } from '@/lib/listings/pipeline/notify';
import { aiProfile } from '@/lib/listings/pipeline/ai-filter';

// notify (step 7) with its neighbours mocked: no channel means no AI call; a channel failing while
// another delivered is a warning, not an error.

vi.mock('@/lib/ai/runs', () => ({ assessJobs: vi.fn() }));
vi.mock('@/lib/channels', () => ({ activeChannels: vi.fn(), deliver: vi.fn() }));
vi.mock('@/lib/listings/pipeline/ai-filter', () => ({ aiProfile: vi.fn() }));
vi.mock('@/lib/db/repos/notify-queue', () => ({
  list: vi.fn(),
  claim: vi.fn(),
  enqueue: vi.fn(() => Promise.resolve()),
}));
vi.mock('@/lib/db/repos/scrape-settings', () => ({ get: vi.fn(() => Promise.resolve({})) }));
vi.mock('@/lib/db/repos/scrape-state', () => ({ get: vi.fn(() => Promise.resolve({ muted: false })) }));

const row = (id: string) => ({
  src: 'justjoin',
  id,
  title: `Offer ${id}`,
  company: null,
  seniority: null,
  remote: null,
  location: null,
  url: `https://x.test/${id}`,
  jobId: `job-${id}`,
  queuedAt: new Date().toISOString(),
});
const queued = [row('1'), row('2')];
const channel = { name: 'Push', ready: () => true, send: vi.fn() };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(queueRepo.list).mockResolvedValue(queued);
  vi.mocked(queueRepo.claim).mockResolvedValue(queued);
  vi.mocked(aiProfile).mockResolvedValue({ id: 'p', version: 1, name: 'Me' } as Awaited<ReturnType<typeof aiProfile>>);
  vi.mocked(assessJobs).mockResolvedValue({ verdicts: new Map(), checked: 0 } as unknown as Awaited<
    ReturnType<typeof assessJobs>
  >);
});

describe('notify', () => {
  it('no channel: nothing is claimed, and the AI isn’t asked', async () => {
    vi.mocked(activeChannels).mockResolvedValue([]);
    expect(await notify({ manual: true })).toEqual({ sent: 0, matched: null, noChannel: true });
    expect(aiProfile).not.toHaveBeenCalled();
    expect(assessJobs).not.toHaveBeenCalled();
    expect(queueRepo.claim).not.toHaveBeenCalled();
  });

  it('one channel failed, another delivered: sent, with a warning', async () => {
    vi.mocked(aiProfile).mockResolvedValue(null);
    vi.mocked(activeChannels).mockResolvedValue([channel, { ...channel, name: 'Telegram' }]);
    vi.mocked(deliver).mockResolvedValue({ unsent: [], errors: ['Telegram sendMessage: HTTP 500'] });
    expect(await notify()).toEqual({ sent: 2, matched: null, warning: 'Telegram sendMessage: HTTP 500' });
    expect(queueRepo.enqueue).not.toHaveBeenCalled();
  });

  it('no channel delivered: an error, and the offers go back into the queue', async () => {
    vi.mocked(aiProfile).mockResolvedValue(null);
    vi.mocked(activeChannels).mockResolvedValue([channel]);
    vi.mocked(deliver).mockResolvedValue({ unsent: queued, errors: ['Push: the push service couldn’t be reached'] });
    expect(await notify()).toEqual({ sent: 0, matched: null, error: 'Push: the push service couldn’t be reached' });
    expect(queueRepo.enqueue).toHaveBeenCalledWith(queued);
  });
});
