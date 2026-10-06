import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { extractJob, type ExtractedJob } from '@/lib/ai/openai';
import { fillFromTextAction } from '@/features/applications/actions';

// "Fill in from the ad text": for a page that can't be read, the AI reads the text you pasted.

vi.mock('@/server/session', () => ({ requireLogin: vi.fn(() => Promise.resolve()) }));
vi.mock('next/cache', () => ({ refresh: vi.fn() }));
vi.mock('next/headers', () => ({ headers: () => Promise.resolve(new Headers()) }));
vi.mock('@/lib/applications', () => ({}));
vi.mock('@/lib/ai/openai', () => ({ extractJob: vi.fn() }));
const extract = vi.mocked(extractJob);

const job: ExtractedJob = {
  title: 'React Developer',
  company: 'Acme',
  location: 'Warszawa',
  workMode: 'unknown',
  officeDays: '',
  salary: '20k',
  contract: 'B2B',
  seniority: 'mid',
  skills: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('OPENAI_API_KEY', 'test-key');
  extract.mockResolvedValue(job);
});
afterEach(() => vi.unstubAllEnvs());

describe('fillFromTextAction', () => {
  it('fills in what the AI read, and leaves the link, the board and the text to the form', async () => {
    const answer = await fillFromTextAction({ text: '  The ad  ', link: 'https://www.linkedin.com/jobs/view/1' });
    expect(extract).toHaveBeenCalledWith({
      url: 'https://www.linkedin.com/jobs/view/1',
      pageTitle: '',
      text: 'The ad',
    });
    expect(answer).toMatchObject({
      ok: true,
      data: {
        url: '',
        board: '',
        title: 'React Developer',
        company: 'Acme',
        workMode: '', // "unknown" is not a work mode
        salary: '20k',
        content: '',
        known: null,
      },
    });
  });

  it('gives the AI only a link that is one', async () => {
    await fillFromTextAction({ text: 'The ad', link: 'not a link' });
    expect(extract).toHaveBeenCalledWith(expect.objectContaining({ url: '' }));
  });

  it('refuses an empty text, and works only with the AI', async () => {
    expect(await fillFromTextAction({ text: '  ', link: '' })).toEqual({
      ok: false,
      error: 'Paste the ad text first.',
    });
    vi.stubEnv('OPENAI_API_KEY', '');
    expect(await fillFromTextAction({ text: 'The ad', link: '' })).toMatchObject({ ok: false });
    expect(extract).not.toHaveBeenCalled();
  });
});
