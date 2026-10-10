import { expect, it } from 'vitest';
import * as jobNotesRepo from '@/lib/db/repos/job-notes';
import * as detailsRepo from '@/lib/db/repos/offer-details';
import * as offersRepo from '@/lib/db/repos/offers';
import { describeDb, ISO } from './database';

// An offer's window in the database: the note on a job (saved only over the version you saw), and the
// complete ad, which an AI run's shorter copy doesn't overwrite.

const JOB = 'acme|reactdeveloper';

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
    await offersRepo.ingest([
      {
        ...offer,
        title: 'Lider Technologiczny',
        company: 'Rossmann',
        seniority: null,
        remote: false,
        url: 'https://x.example/1',
      },
    ]);
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
});
