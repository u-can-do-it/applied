import { describe, expect, it } from 'vitest';
import { editedDetails, mergeDetails, typedDetails, typedFields } from '@/lib/applications';

describe('typedDetails', () => {
  it('the editable fields you filled in, and their names', () => {
    expect(typedDetails({ salary: '25 000 PLN', location: 'Warszawa', remote: true })).toEqual({
      salary: '25 000 PLN', location: 'Warszawa', remote: true, typed: ['salary', 'location', 'remote'],
    });
  });

  it('never the ad-only fields, nor empty ones', () => {
    expect(typedDetails({ posted: '2026-10-01', validUntil: '2026-11-01', company: 'Acme', contract: '', remote: false })).toEqual({});
    expect(typedDetails(null)).toEqual({});
  });
});

describe('typedFields', () => {
  it('the saved list, without anything that is not an editable field', () => {
    expect(typedFields({ salary: 'x', typed: ['salary', 'posted' as never] }, 'jk123')).toEqual(['salary']);
    expect(typedFields({ salary: 'x', typed: [] }, 'manual-abc')).toEqual([]);
  });

  it('a row from before the list: added by hand or imported, every editable field it has', () => {
    expect(typedFields({ salary: 'x', remote: true, posted: '2026-10-01' }, 'manual-abc')).toEqual(['salary', 'remote']);
    expect(typedFields({ contract: 'B2B' }, 'import-1')).toEqual(['contract']);
    // marked on a scraped offer: all of it is the board's
    expect(typedFields({ salary: 'x' }, '4123456789')).toEqual([]);
    expect(typedFields(null, 'manual-abc')).toEqual([]);
  });
});

describe('mergeDetails', () => {
  const board = { salary: '20 000 PLN / month', contract: 'B2B', location: 'Kraków', posted: '2026-10-01', company: 'Acme' };

  it('the fields you typed stay, the rest is what the board says', () => {
    const saved = { salary: '25 000 PLN / month', location: 'Warszawa', posted: '2026-09-01', typed: ['salary' as const] };
    expect(mergeDetails(board, saved, ['salary'])).toEqual({ ...board, salary: '25 000 PLN / month', typed: ['salary'] });
  });

  it('nothing typed: a fresh scrape replaces the saved details', () => {
    expect(mergeDetails({ contract: 'B2B' }, { contract: 'UoP', salary: 'old' }, [])).toEqual({ contract: 'B2B' });
  });

  it('a typed field without a value is the board\'s', () => {
    expect(mergeDetails(board, { location: 'Warszawa' }, ['salary', 'location'])).toEqual({ ...board, location: 'Warszawa' });
  });

  it('a scrape that says nothing keeps the saved details (a failed fetch never wipes them)', () => {
    const saved = { salary: '25 000 PLN / month', remote: true, posted: '2026-10-01', typed: ['salary' as const, 'remote' as const] };
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
  const saved = { salary: '20 000 PLN', contract: 'B2B', location: 'Kraków', posted: '2026-10-01', company: 'Acme', typed: ['location' as const] };
  const form = { salary: '20 000 PLN', contract: 'B2B', location: 'Kraków' };

  it('a value saved as the board gave it and left alone is still the board\'s', () => {
    expect(editedDetails(saved, form, '4123456789', true)).toEqual({ ...form, posted: '2026-10-01', company: 'Acme', typed: ['location'] });
  });

  it('a changed value is yours; one typed before stays yours', () => {
    expect(editedDetails(saved, { ...form, salary: '25 000 PLN', remote: true }, '4123456789', true)).toEqual({
      salary: '25 000 PLN', contract: 'B2B', location: 'Kraków', remote: true, posted: '2026-10-01', company: 'Acme', typed: ['salary', 'location', 'remote'],
    });
  });

  it('a cleared field goes, and is no longer yours', () => {
    expect(editedDetails(saved, { salary: '20 000 PLN', contract: 'B2B' }, '4123456789', true)).toEqual({
      salary: '20 000 PLN', contract: 'B2B', posted: '2026-10-01', company: 'Acme', typed: [],
    });
  });

  it('an old row added by hand: what it had was typed', () => {
    expect(editedDetails({ salary: 'x', contract: 'B2B' }, { salary: 'x', contract: 'B2B' }, 'manual-abc', true)).toEqual({
      salary: 'x', contract: 'B2B', typed: ['salary', 'contract'],
    });
  });

  it('a new link: only what you filled in, without the old ad\'s dates and company', () => {
    expect(editedDetails(saved, form, '4123456789', false)).toEqual({ ...form, typed: ['salary', 'contract', 'location'] });
    expect(editedDetails(saved, {}, '4123456789', false)).toBeNull();
  });

  it('nothing left: null', () => {
    expect(editedDetails({ salary: 'x' }, {}, '1', true)).toBeNull();
  });
});
