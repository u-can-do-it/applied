import { expect, it, vi } from 'vitest';
import { readJobPage, scrapeOfferFull } from '@/lib/ads';
import { extractJob } from '@/lib/ai/openai';
import { getApplication, markApplied, saveContent } from '@/lib/applications';
import * as jobNotesRepo from '@/lib/db/repos/job-notes';
import * as detailsRepo from '@/lib/db/repos/offer-details';
import * as offersRepo from '@/lib/db/repos/offers';
import { setJobAd, setJobAdFromLink } from '@/lib/offer-window';
import { describeDb, ISO } from './database';

// An offer's window in the database: the note on a job (saved only over the version you saw), and the
// complete ad, which an AI run's shorter copy doesn't overwrite.

const JOB = 'acme|reactdeveloper';

// never the real AI (reading the details from the ad text)
vi.mock('@/lib/ai/openai', () => ({
  extractJob: vi.fn(() => Promise.reject(new Error('no AI'))),
  assessOffers: vi.fn(),
}));
// the board never answers here: what's shown is what was saved
vi.mock('@/lib/ads', async (original) => ({
  ...(await original<typeof import('@/lib/ads')>()),
  scrapeOfferFull: vi.fn(() => Promise.reject(new Error('HTTP 429'))),
  readJobPage: vi.fn(),
}));

describeDb('the note on a job', () => {
  it('the first save makes it; a second "first" one finds it there (changed elsewhere)', async () => {
    const at = await jobNotesRepo.setIfUnchanged(JOB, 'Ask about the team', null);
    expect(at).toMatch(ISO);
    expect(await jobNotesRepo.setIfUnchanged(JOB, 'from another tab', null)).toBeNull();
    expect(await jobNotesRepo.get(JOB)).toEqual({ note: 'Ask about the team', noteUpdatedAt: at });
  });

  it('saved over the version you saw, not over another one', async () => {
    const first = await jobNotesRepo.setIfUnchanged(JOB, 'one', null);
    const second = await jobNotesRepo.setIfUnchanged(JOB, 'two', first);
    expect(second).toMatch(ISO);
    expect(second).not.toBe(first);
    expect(await jobNotesRepo.setIfUnchanged(JOB, 'stale', first)).toBeNull();
    expect((await jobNotesRepo.get(JOB))?.note).toBe('two');
  });

  it('taken (to the application): it leaves the job', async () => {
    const at = await jobNotesRepo.setIfUnchanged(JOB, 'Ask about the team', null);
    expect(await jobNotesRepo.take(JOB)).toEqual({ note: 'Ask about the team', noteUpdatedAt: at });
    expect(await jobNotesRepo.get(JOB)).toBeNull();
    expect(await jobNotesRepo.take(JOB)).toBeNull();
  });
});

describeDb('the complete ad', () => {
  const offer = { src: 'eldorado', id: '455630' };

  async function anOffer() {
    const [added] = await offersRepo.ingest([
      {
        ...offer,
        title: 'Lider Technologiczny',
        company: 'Rossmann',
        seniority: null,
        remote: false,
        url: 'https://x.example/1',
      },
    ]);
    return added.titleKey;
  }

  it("the window's complete ad, with the board's details, over an AI run's shorter copy", async () => {
    await anOffer();
    await detailsRepo.save([{ ...offer, status: 'ok', description: 'the first 8000 characters' }]);
    await detailsRepo.saveComplete({
      ...offer,
      status: 'ok',
      description: 'the whole ad',
      details: { contract: 'B2B' },
    });
    const [row] = await detailsRepo.forOffers([offer]);
    expect(row).toMatchObject({ description: 'the whole ad', details: { contract: 'B2B' }, complete: true });
    expect(row.fetchedAt).toMatch(ISO);
  });

  it("an AI run's copy saved after it doesn't overwrite it", async () => {
    await anOffer();
    await detailsRepo.saveComplete({ ...offer, status: 'ok', description: 'the whole ad', details: null });
    await detailsRepo.save([{ ...offer, status: 'ok', description: 'the first 8000 characters' }]);
    const [row] = await detailsRepo.forOffers([offer]);
    expect(row).toMatchObject({ description: 'the whole ad', complete: true });
  });

  it('the ad you paste: kept complete, with what the board said besides; marking the job applied takes it', async () => {
    const jobId = await anOffer();
    await detailsRepo.saveComplete({ ...offer, status: 'empty', description: null, details: { contract: 'B2B' } });
    expect(await setJobAd(jobId, 'React 19, Next.js')).toMatchObject({
      content: 'React 19, Next.js',
      contentStatus: 'ok',
      details: { contract: 'B2B' },
    });
    await detailsRepo.save([{ ...offer, status: 'empty', description: null }]); // an AI run's read
    expect((await detailsRepo.forOffers([offer]))[0]).toMatchObject({ status: 'ok', description: 'React 19, Next.js' });

    await markApplied(jobId, offer);
    await saveContent(jobId); // the board doesn't answer
    expect(vi.mocked(scrapeOfferFull)).toHaveBeenCalled();
    expect(await getApplication(jobId)).toMatchObject({ contentStatus: 'ok', content: 'React 19, Next.js' });
  });

  it('the ad read from a link you pasted: saved as yours; the AI fills in what the board didn’t say', async () => {
    const jobId = await anOffer();
    await detailsRepo.saveComplete({ ...offer, status: 'empty', description: null, details: { contract: 'B2B' } });
    const text = 'React 19, Next.js, design systems. '.repeat(4);
    vi.mocked(readJobPage).mockResolvedValue({ pageTitle: 'Frontend', text, details: { location: 'Warszawa' } });
    vi.stubEnv('OPENAI_API_KEY', 'test-key');
    vi.mocked(extractJob).mockResolvedValueOnce({
      title: 'Frontend',
      company: 'Rossmann',
      location: 'Łódź',
      workMode: 'hybrid',
      officeDays: '',
      salary: '30 000 PLN / month',
      contract: 'UoP',
      seniority: 'senior',
      skills: [{ name: 'React', level: 4, note: '' }],
    });
    expect(await setJobAdFromLink(jobId, ' https://careers.rossmann.pl/jobs/42 ')).toEqual({
      content: text.trim(),
      contentStatus: 'ok',
      contentError: null,
      scrapedAt: expect.stringMatching(ISO) as unknown,
      // the board's first, then the page's, then the AI's
      details: {
        contract: 'B2B',
        location: 'Warszawa',
        company: 'Rossmann',
        salary: '30 000 PLN / month',
        workMode: 'hybrid',
        skills: [{ name: 'React', level: 4 }],
      },
      warning: undefined,
    });
    expect(vi.mocked(readJobPage)).toHaveBeenCalledWith({
      src: 'rossmann',
      id: '',
      url: 'https://careers.rossmann.pl/jobs/42',
    });

    // a login wall: nothing saved, and it says why
    vi.mocked(readJobPage).mockResolvedValue({ pageTitle: 'Sign in', text: 'Sign in to see', details: {} });
    await expect(setJobAdFromLink(jobId, 'https://linkedin.com/jobs/view/1')).rejects.toThrow(/no ad text/);
    expect((await detailsRepo.forOffers([offer]))[0].description).toBe(text.trim());
  });
});
