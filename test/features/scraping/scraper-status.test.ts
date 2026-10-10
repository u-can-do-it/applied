import { describe, expect, it } from 'vitest';
import { fetchedVia } from '@/features/scraping/scraper-status';

describe('fetchedVia', () => {
  it('says how a board that blocks the server was reached', () => {
    expect(fetchedVia({ src: 'eldorado', lastProxied: 0 })).toBe('fetched directly');
    expect(fetchedVia({ src: 'eldorado', lastProxied: 1 })).toBe('through ScrapingAnt (1 page)');
    expect(fetchedVia({ src: 'eldorado', lastProxied: 3 })).toBe('through ScrapingAnt (3 pages)');
  });

  it('nothing for the other boards, nor for a run from before it was counted', () => {
    expect(fetchedVia({ src: 'justjoin', lastProxied: 0 })).toBeNull();
    expect(fetchedVia({ src: 'eldorado', lastProxied: null })).toBeNull();
  });
});
