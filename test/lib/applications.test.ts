import { afterEach, describe, expect, it, vi } from 'vitest';
import { extractJob, type ExtractedJob } from '@/lib/ai/openai';
import { editedDetails, mergeDetails, typedDetails, typedFields, withTextDetails } from '@/lib/applications';

vi.mock('@/lib/ai/openai', () => ({ extractJob: vi.fn() }));
const extract = vi.mocked(extractJob);

describe('typedDetails', () => {
  it('the editable fields you filled in, and their names', () => {
    expect(typedDetails({ salary: '25 000 PLN', location: 'Warszawa', remote: true })).toEqual({
      salary: '25 000 PLN',
      location: 'Warszawa',
      remote: true,
      typed: ['salary', 'location', 'remote'],
    });
  });

  it('never the ad-only fields, nor empty ones', () => {
    expect(
      typedDetails({ posted: '2026-10-01', validUntil: '2026-11-01', company: 'Acme', contract: '', remote: false }),
    ).toEqual({});
    expect(typedDetails(null)).toEqual({});
  });
});

describe('typedFields', () => {
  it('the saved list, without anything that is not an editable field', () => {
    expect(typedFields({ salary: 'x', typed: ['salary', 'posted' as never] }, 'jk123')).toEqual(['salary']);
    expect(typedFields({ salary: 'x', typed: [] }, 'manual-abc')).toEqual([]);
  });

  it('a row from before the list: added by hand or imported, every editable field it has', () => {
    expect(typedFields({ salary: 'x', remote: true, posted: '2026-10-01' }, 'manual-abc')).toEqual([
      'salary',
      'remote',
      'workMode',
    ]);
    expect(typedFields({ contract: 'B2B' }, 'import-1')).toEqual(['contract']);
    // marked on a scraped offer: all of it is the board's
    expect(typedFields({ salary: 'x' }, '4123456789')).toEqual([]);
    expect(typedFields(null, 'manual-abc')).toEqual([]);
  });
});

describe('typedFields and the work mode', () => {
  it('"remote" typed before there was a work mode: the work mode is yours too', () => {
    expect(typedFields({ remote: true, typed: ['remote'] }, 'jk123')).toEqual(['remote', 'workMode']);
    expect(typedFields({ workMode: 'hybrid', typed: ['workMode'] }, 'jk123')).toEqual(['workMode']);
  });
});

describe('mergeDetails', () => {
  const board = {
    salary: '20 000 PLN / month',
    contract: 'B2B',
    location: 'Kraków',
    posted: '2026-10-01',
    company: 'Acme',
  };

  it('the fields you typed stay, the rest is what the board says', () => {
    const saved = {
      salary: '25 000 PLN / month',
      location: 'Warszawa',
      posted: '2026-09-01',
      typed: ['salary' as const],
    };
    expect(mergeDetails(board, saved, ['salary'])).toEqual({
      ...board,
      salary: '25 000 PLN / month',
      typed: ['salary'],
    });
  });

  it('nothing typed: a fresh scrape replaces the saved details', () => {
    expect(mergeDetails({ contract: 'B2B' }, { contract: 'UoP', salary: 'old' }, [])).toEqual({ contract: 'B2B' });
  });

  it("a typed field without a value is the board's", () => {
    expect(mergeDetails(board, { location: 'Warszawa' }, ['salary', 'location'])).toEqual({
      ...board,
      location: 'Warszawa',
    });
  });

  it('a scrape that says nothing keeps the saved details (a failed fetch never wipes them)', () => {
    const saved = {
      salary: '25 000 PLN / month',
      remote: true,
      posted: '2026-10-01',
      typed: ['salary' as const, 'remote' as const],
    };
    for (const scraped of [undefined, null, {}, { salary: undefined, contract: '' }]) {
      expect(mergeDetails(scraped, saved, ['salary', 'remote'])).toEqual(saved);
    }
    expect(mergeDetails(undefined, { contract: 'B2B' }, [])).toEqual({ contract: 'B2B' });
  });

  it('nothing at all: null', () => {
    expect(mergeDetails(undefined, null, [])).toBeNull();
    expect(mergeDetails({}, { typed: [] }, [])).toBeNull();
  });
});

describe('editedDetails', () => {
  const saved = {
    salary: '20 000 PLN',
    contract: 'B2B',
    location: 'Kraków',
    posted: '2026-10-01',
    company: 'Acme',
    typed: ['location' as const],
  };
  const form = { salary: '20 000 PLN', contract: 'B2B', location: 'Kraków' };

  it("a value saved as the board gave it and left alone is still the board's", () => {
    expect(editedDetails(saved, form, '4123456789', true)).toEqual({
      ...form,
      posted: '2026-10-01',
      company: 'Acme',
      typed: ['location'],
    });
  });

  it('a changed value is yours; one typed before stays yours', () => {
    expect(editedDetails(saved, { ...form, salary: '25 000 PLN', remote: true }, '4123456789', true)).toEqual({
      salary: '25 000 PLN',
      contract: 'B2B',
      location: 'Kraków',
      remote: true,
      posted: '2026-10-01',
      company: 'Acme',
      typed: ['salary', 'location', 'remote'],
    });
  });

  it('a cleared field goes, and is no longer yours', () => {
    expect(editedDetails(saved, { salary: '20 000 PLN', contract: 'B2B' }, '4123456789', true)).toEqual({
      salary: '20 000 PLN',
      contract: 'B2B',
      posted: '2026-10-01',
      company: 'Acme',
      typed: [],
    });
  });

  it('an old row added by hand: what it had was typed', () => {
    expect(
      editedDetails({ salary: 'x', contract: 'B2B' }, { salary: 'x', contract: 'B2B' }, 'manual-abc', true),
    ).toEqual({
      salary: 'x',
      contract: 'B2B',
      typed: ['salary', 'contract'],
    });
  });

  it("a new link: only what you filled in, without the old ad's dates and company", () => {
    expect(editedDetails(saved, form, '4123456789', false)).toEqual({
      ...form,
      typed: ['salary', 'contract', 'location'],
    });
    expect(editedDetails(saved, {}, '4123456789', false)).toBeNull();
  });

  it('nothing left: null', () => {
    expect(editedDetails({ salary: 'x' }, {}, '1', true)).toBeNull();
  });

  it("an old remote row shown as work mode remote, left alone: still the board's", () => {
    expect(editedDetails({ remote: true }, { remote: true, workMode: 'remote' }, '4123456789', true)).toEqual({
      remote: true,
      workMode: 'remote',
      typed: [],
    });
    expect(
      editedDetails({ remote: true }, { workMode: 'hybrid', officeDays: '2 office / 3 home' }, '4123456789', true),
    ).toEqual({ workMode: 'hybrid', officeDays: '2 office / 3 home', typed: ['workMode', 'officeDays'] });
  });
});

describe('withTextDetails', () => {
  const app = { url: 'https://theprotocol.it/x', title: 'Frontend Developer', content: 'Praca hybrydowa…' };
  const read: ExtractedJob = {
    title: 'Frontend Developer',
    company: 'Empik',
    location: 'Warszawa',
    workMode: 'hybrid',
    officeDays: '2 office / 3 home',
    salary: '',
    contract: 'Permanent (UoP)',
    seniority: 'mid',
  };
  afterEach(() => {
    vi.unstubAllEnvs();
    extract.mockReset();
  });

  it('fills only what nobody gave, and marks the text read', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'test-key');
    extract.mockResolvedValueOnce(read);
    const { textRead, ...details } = (await withTextDetails({ contract: 'B2B', typed: ['contract'] }, app)) ?? {};
    expect(details).toEqual({
      contract: 'B2B',
      location: 'Warszawa',
      workMode: 'hybrid',
      officeDays: '2 office / 3 home',
      typed: ['contract'],
    });
    expect(textRead).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('a remote row stays remote, without days in the office', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'test-key');
    extract.mockResolvedValueOnce(read);
    const details = await withTextDetails({ remote: true }, app);
    expect(details).toMatchObject({ remote: true, workMode: 'remote', location: 'Warszawa' });
    expect(details?.officeDays).toBeUndefined();
  });

  it('no key, no text or the AI failing: the details as they were, unmarked', async () => {
    vi.stubEnv('OPENAI_API_KEY', '');
    expect(await withTextDetails({ salary: 'x' }, app)).toEqual({ salary: 'x' });
    vi.stubEnv('OPENAI_API_KEY', 'test-key');
    expect(await withTextDetails(null, { ...app, content: ' ' })).toBeNull();
    extract.mockRejectedValueOnce(new Error('timeout'));
    expect(await withTextDetails({ salary: 'x' }, app)).toEqual({ salary: 'x' });
    expect(extract).toHaveBeenCalledTimes(1);
  });
});
