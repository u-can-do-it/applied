// Shared by the server and client components.

/**
 * An AI fit's tier, the fit badge's colour (features/offers/fit-score.tsx) and the day headings'
 * counts (lib/db/repos/offers.ts): a job your criteria allow is good from 70%, fair from 40%; one
 * they rule out (`match` false) is neither, whatever its score.
 */
export const GOOD_FIT = 70;
export const FAIR_FIT = 40;

export type FitTier = 'good' | 'fair' | 'poor';

export const fitTier = (match: boolean, score: number): FitTier =>
  !match ? 'poor' : score >= GOOD_FIT ? 'good' : score >= FAIR_FIT ? 'fair' : 'poor';

/** a tier's Badge variant (components/ui/badge.tsx) */
export const FIT_BADGE = { good: 'success-soft', fair: 'warning-soft', poor: 'muted' } as const satisfies Record<
  FitTier,
  string
>;
