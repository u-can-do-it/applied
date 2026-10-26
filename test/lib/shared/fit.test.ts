import { expect, it } from 'vitest';
import { FAIR_FIT, fitTier, GOOD_FIT } from '@/lib/shared/fit';

it('tiers a fit by its score, a job your criteria rule out poor whatever its score', () => {
  expect(fitTier(true, GOOD_FIT)).toBe('good');
  expect(fitTier(true, GOOD_FIT - 1)).toBe('fair');
  expect(fitTier(true, FAIR_FIT)).toBe('fair');
  expect(fitTier(true, FAIR_FIT - 1)).toBe('poor');
  expect(fitTier(false, 100)).toBe('poor');
});
