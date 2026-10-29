import { describe, expect, it } from 'vitest';
import { detailsWords } from '@/lib/ads/details';

describe('detailsWords', () => {
  it('the salary (its numbers without spaces too), contract, work mode, where and the skills', () => {
    expect(
      detailsWords({
        salary: '20 200–23 500 PLN / month',
        contract: 'B2B',
        workMode: 'hybrid',
        officeDays: '2 office / 3 home',
        location: 'Warszawa',
        skills: [
          { name: 'React', level: 4 },
          { name: 'English', note: 'C1' },
        ],
      }),
    ).toBe(
      '20 200–23 500 PLN / month · 20200–23500 PLN / month · B2B · Hybrid (2 office / 3 home) · Warszawa · React · English',
    );
  });

  it('a salary without spaces in its numbers once; nothing known, nothing', () => {
    expect(detailsWords({ salary: '$120k–150k / year' })).toBe('$120k–150k / year');
    expect(detailsWords({ salary: '20 200 PLN' })).toBe('20 200 PLN · 20200 PLN');
    expect(detailsWords(null)).toBe('');
    expect(detailsWords({})).toBe('');
  });
});
