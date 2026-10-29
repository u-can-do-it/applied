import { afterEach, describe, expect, it, vi } from 'vitest';
import { scrapeOffer } from '@/lib/ads';

// The salaries in JustJoin's and NoFluff's offer APIs, as recorded 2026-10-29 (RITS' Senior Software Engineer on
// JustJoin; GFT's Senior Python Engineer and Innowise's Trainee Node Developer on NoFluff), the rest left out.

const answer = (body: object) =>
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve(new Response(JSON.stringify(body)))),
  );
afterEach(() => {
  vi.unstubAllGlobals();
});

const LONG = 'Rozwijasz systemy backendowe w Javie i dbasz o ich jakość razem z zespołem produktowym.';

describe('JustJoin', () => {
  const offer = {
    src: 'justjoin',
    id: 'rits-senior-software-engineer-warszawa-java',
    url: 'https://justjoin.it/job-offer/rits-senior-software-engineer-warszawa-java',
  };
  // per type, its conversions to other currencies besides the offer's own
  const pay = (type: string, gross: boolean, from: number, to: number, unit = 'Month') => [
    { from, to, currency: 'EUR', currencySource: 'conversion', type, unit, gross },
    { from, to, currency: 'PLN', currencySource: 'original', type, unit, gross },
  ];

  it('each contract with whether it is gross or net, per its unit', async () => {
    answer({
      body: `<p>${LONG}</p>`,
      employmentTypes: [
        ...pay('b2b', false, 16800, 23520, 'Hour').map((employment) => ({
          ...employment,
          fromPerUnit: 100,
          toPerUnit: 140,
        })),
        ...pay('permanent', true, 14000, 19000),
      ],
    });
    expect((await scrapeOffer(offer)).details).toMatchObject({
      salary: '100–140 PLN net / hour (B2B); 14 000–19 000 PLN gross / month (Permanent (UoP))',
      contract: 'B2B, Permanent (UoP)',
    });
  });
});

describe('NoFluff', () => {
  const offer = {
    src: 'nofluff',
    id: 'senior-python-engineer-gft-poland-Kraków-4',
    url: 'https://nofluffjobs.com/pl/job/senior-python-engineer-gft-poland-krakow-5',
  };

  it('each contract with an amount; one without (an internship) has none', async () => {
    answer({
      details: { description: `<p>${LONG}</p>` },
      essentials: {
        originalSalary: {
          currency: 'PLN',
          types: { permanent: { period: 'Month', range: [14500, 22300], paidHoliday: true }, intern: true },
        },
      },
    });
    expect((await scrapeOffer(offer)).details).toMatchObject({
      salary: '14 500–22 300 PLN / month (Permanent (UoP))',
      contract: 'Permanent (UoP), Internship',
    });
  });

  it('only a contract without an amount: no salary', async () => {
    answer({
      details: { description: `<p>${LONG}</p>` },
      essentials: { originalSalary: { currency: 'PLN', types: { intern: true } } },
    });
    expect((await scrapeOffer(offer)).details.salary).toBeUndefined();
  });
});
