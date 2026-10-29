import { afterEach, describe, expect, it, vi } from 'vitest';
import { scrapeOffer } from '@/lib/ads';

// Solid.jobs' ad: the page's JobPosting, its salaries from the page's Angular state (ng-state). The fields are
// those of a page recorded 2026-10-29 (Blackbird's Senior Frontend Vue/Next), its texts cut short.

const answer = (html: string) =>
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve(new Response(html))),
  );
afterEach(() => {
  vi.unstubAllGlobals();
});

const offer = {
  src: 'solidjobs',
  id: '55649b21-05a0-4071-889e-dd2528a7b934',
  url: 'https://solid.jobs/o/g0a1bf2c/jobwatch',
};

// the board's monthly figure: 100–140 PLN an hour, converted
const posting = {
  '@type': 'JobPosting',
  description: '<p>Szukamy osoby, która rozwija frontend w Vue i Next.js, pracując z zespołem produktowym.</p>',
  baseSalary: {
    '@type': 'MonetaryAmount',
    currency: 'PLN',
    value: { '@type': 'QuantitativeValue', minValue: 16800, maxValue: 23500, unitText: 'MONTH' },
  },
};
const b2b = { lowerBound: 100, upperBound: 140, currency: 'PLN', employmentType: 'B2B', salaryPeriod: 'Hour' };
const page = (details: object) =>
  `<html><head><script type="application/ld+json">${JSON.stringify(posting)}</script></head><body>` +
  `<script id="ng-state" type="application/json">${JSON.stringify({
    '05cd10012068f58399ecd2bd2fe8f3ab5acaaf33': {
      b: { hot: [], warm: [] },
      u: 'https://solid.jobs/api/offers/popularity',
    },
    '7fde04e0308ac71ff27ed1ebb057ad5a83e55624': {
      b: { isFound: true, isExpired: false, jobOfferDetails: { jobOfferKey: offer.id, ...details } },
      u: 'https://solid.jobs/api/offers/39463/blackbird-senior-frontend-vue-next',
    },
  })}</script></body></html>`;

describe('Solid.jobs', () => {
  it("the ad's own rate, not the board's monthly figure", async () => {
    answer(
      page({
        salaryRange: b2b,
        normalizedSalaryRange: {
          lowerBound: 16800,
          upperBound: 23500,
          currency: 'PLN',
          employmentType: 'B2B',
          salaryPeriod: 'Month',
        },
      }),
    );
    const ad = await scrapeOffer(offer);
    expect(ad.status).toBe('ok');
    expect(ad.details).toMatchObject({ salary: '100–140 PLN / hour (B2B)', contract: 'B2B' });
  });

  it('a second contract, one amount', async () => {
    answer(
      page({
        salaryRange: b2b,
        secondarySalaryRange: {
          lowerBound: 9000,
          upperBound: 9000,
          currency: 'PLN',
          employmentType: 'Umowa o pracę',
          salaryPeriod: 'Month',
        },
      }),
    );
    expect((await scrapeOffer(offer)).details).toMatchObject({
      salary: '100–140 PLN / hour (B2B); 9000 PLN / month (UoP)',
      contract: 'B2B, Permanent (UoP)',
    });
  });

  it("no state in the page: the JobPosting's", async () => {
    answer(`<script type="application/ld+json">${JSON.stringify(posting)}</script>`);
    expect((await scrapeOffer(offer)).details.salary).toBe('16 800–23 500 PLN / month');
  });
});
