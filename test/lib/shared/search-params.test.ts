import { describe, expect, it } from 'vitest';
import { seconds } from '@/lib/shared/format';
import { one, parseOfferQuery } from '@/lib/shared/search-params';

describe('one', () => {
  it('reads the first value of a repeated parameter, and a missing one as empty', () => {
    expect(one(['a', 'b'])).toBe('a');
    expect(one('a')).toBe('a');
    expect(one(undefined)).toBe('');
  });
});

describe('parseOfferQuery', () => {
  it('keeps the filters that make sense', () => {
    expect(
      parseOfferQuery({ q: 'react', src: 'justjoin', page: '2', days: '7', rejected: '1', new: '1', archived: '1' }),
    ).toEqual({
      q: 'react',
      src: 'justjoin',
      page: 2,
      days: '7',
      from: '',
      to: '',
      rejected: true,
      latest: true,
      archived: true,
    });
  });

  it('drops what does not', () => {
    expect(
      parseOfferQuery({ q: 'x'.repeat(300), src: 'Not a board', page: '-3', days: '12', from: '2026-02-30', new: 'y' }),
    ).toEqual({
      q: 'x'.repeat(200),
      src: '',
      page: 0,
      days: '',
      from: '',
      to: '',
      rejected: false,
      latest: false,
      archived: false,
    });
  });

  it('a day preset wins over a range', () => {
    expect(parseOfferQuery({ days: 'yesterday', from: '2026-10-01', to: '2026-10-02' })).toMatchObject({
      days: 'yesterday',
      from: '',
      to: '',
    });
    expect(parseOfferQuery({ from: '2026-10-01', to: '2026-10-02' })).toMatchObject({
      days: '',
      from: '2026-10-01',
      to: '2026-10-02',
    });
  });
});

describe('seconds', () => {
  it('shows tenths under 10 s, unless asked for a fixed precision', () => {
    expect(seconds(1234)).toBe('1.2 s');
    expect(seconds(12_345)).toBe('12 s');
    expect(seconds(12_345, 1)).toBe('12.3 s');
  });
});
