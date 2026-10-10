import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as applicationsRepo from '@/lib/db/repos/applications';
import * as jobNotesRepo from '@/lib/db/repos/job-notes';
import * as offersRepo from '@/lib/db/repos/offers';
import { markApplied } from '@/lib/applications';

// Marking a job applied: the note you wrote in its offer window goes with it, to the application.

vi.mock('@/lib/db/repos/applications', () => ({ insertUnlessThere: vi.fn() }));
vi.mock('@/lib/db/repos/job-notes', () => ({ get: vi.fn(), take: vi.fn() }));
vi.mock('@/lib/db/repos/offers', () => ({ jobById: vi.fn() }));
const insert = vi.mocked(applicationsRepo.insertUnlessThere);

const JOB = 'acme|reactdeveloper';
const AT = '2026-10-10T10:00:00.000Z';
const offer = { src: 'justjoin', id: 'jj-1', url: 'https://justjoin.it/job-offer/jj-1' };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(offersRepo.jobById).mockResolvedValue({
    ...offer,
    title: 'React Developer',
    company: 'Acme',
    seniority: null,
    remote: true,
    firstSeen: AT,
    jobId: JOB,
    offers: [offer],
    appliedAt: null,
  });
});

describe('markApplied and the note', () => {
  it("the job's note becomes the application's, and leaves the job", async () => {
    vi.mocked(jobNotesRepo.get).mockResolvedValue({ note: 'Ask about the team', noteUpdatedAt: AT });
    await markApplied(JOB, offer);
    expect(insert.mock.lastCall?.[0]).toMatchObject({ jobId: JOB, note: 'Ask about the team', noteUpdatedAt: AT });
    expect(jobNotesRepo.take).toHaveBeenCalledExactlyOnceWith(JOB);
  });

  it('no note: none on the application either', async () => {
    vi.mocked(jobNotesRepo.get).mockResolvedValue(null);
    await markApplied(JOB, offer);
    expect(insert.mock.lastCall?.[0]).not.toHaveProperty('note');
    expect(jobNotesRepo.take).not.toHaveBeenCalled();
  });
});
