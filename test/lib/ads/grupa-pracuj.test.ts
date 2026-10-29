import { afterEach, describe, expect, it, vi } from 'vitest';
import { scrapeOffer } from '@/lib/ads';

// Grupa Pracuj's ads: the page's JobPosting, its salaries (one a contract) from the page's __NEXT_DATA__.
// The Protocol's fields are those of a page recorded 2026-10-21 (CodeTwo's Web Developer), Pracuj.pl's of one
// recorded 2026-10-29 (eRecruitment Solutions' Senior Front-end Developer), their texts cut short.

const answer = (html: string) =>
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve(new Response(html))),
  );
afterEach(() => {
  vi.unstubAllGlobals();
});

const offer = {
  src: 'theprotocol',
  id: '01000000-326a-b7bb-fb5f-08df17a5d77c',
  url: 'https://theprotocol.it/szczegoly/praca/web-developer---programista--ka-stron-www-jelenia-gora,oferta,01000000-326a-b7bb-fb5f-08df17a5d77c',
};

const posting = {
  '@context': 'http://schema.org',
  '@type': 'JobPosting',
  title: 'Web Developer / Programista/-ka stron www',
  hiringOrganization: 'CodeTwo',
  datePosted: '2026-09-21T06:01:55.217Z',
  validThrough: '2026-10-21T21:59:59Z',
  employmentType: ['CONTRACTOR', 'FULL_TIME'],
  description:
    '<b>Nasze wymagania</b><ul><li>Znajomość biblioteki i technologii React, JavaScript, CSS, Typescript.</li></ul>',
  // one range for both contracts, on the MonetaryAmount itself, without its period
  baseSalary: { '@type': 'MonetaryAmount', minValue: 10000, maxValue: 17000, currency: 'PLN' },
  jobLocation: { '@type': 'Place', address: { '@type': 'PostalAddress', addressLocality: 'Jelenia Góra' } },
};
const month = { timeUnitId: 0, timeUnit: { id: 0, shortForm: 'mies.', longForm: 'miesięcznie' } };
const hour = { timeUnitId: 1, timeUnit: { id: 1, shortForm: 'godz.', longForm: 'godzinowo' } };
const contracts = [
  { name: 'umowa o pracę', salary: { from: 10000, to: 17000, currencyCode: 'zł', ...month, kindCode: 'brutto' } },
  { name: 'kontrakt B2B', salary: { from: 10000, to: 17000, currencyCode: 'zł', ...month, kindCode: 'netto (+ VAT)' } },
];
const page = (typesOfContracts: object[], ld: object | null = posting) =>
  `<html><head>${ld ? `<script type="application/ld+json">${JSON.stringify(ld)}</script>` : ''}</head><body>` +
  `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({
    props: { pageProps: { offer: { attributes: { employment: { typesOfContracts } } } } },
  })}</script></body></html>`;

describe('The Protocol', () => {
  it("the JobPosting's ad, a salary a contract from the page's data", async () => {
    answer(page(contracts));
    const ad = await scrapeOffer(offer);
    expect(ad.status).toBe('ok');
    expect(ad.text).toBe('Nasze wymagania\n• Znajomość biblioteki i technologii React, JavaScript, CSS, Typescript.');
    expect(ad.details).toEqual({
      salary: '10 000–17 000 PLN gross / month (UoP); 10 000–17 000 PLN net + VAT / month (B2B)',
      contract: 'Permanent (UoP), B2B',
      location: 'Jelenia Góra',
      posted: '2026-09-21',
      validUntil: '2026-10-21',
      company: 'CodeTwo',
    });
  });

  it('one amount, an hourly rate, a hidden salary', async () => {
    answer(
      page([
        {
          name: 'kontrakt B2B',
          salary: { from: 100, to: 100, currencyCode: 'zł', ...hour, kindCode: 'netto (+ VAT)' },
        },
        { name: 'umowa zlecenie', salary: { from: null, to: 72, currencyCode: 'zł', ...hour, kindCode: 'brutto' } },
        { name: 'umowa o dzieło', salary: null },
      ]),
    );
    expect((await scrapeOffer(offer)).details).toMatchObject({
      salary: '100 PLN net + VAT / hour (B2B); up to 72 PLN gross / hour (zlecenie)',
      contract: 'B2B, Mandate (zlecenie), Specific-task (o dzieło)',
    });
  });

  it("no salary in the page's data: the JobPosting's", async () => {
    answer(page([{ name: 'B2B contract', salary: null }]));
    expect((await scrapeOffer(offer)).details).toMatchObject({ salary: '10 000–17 000 PLN', contract: 'B2B' });
  });
});

describe('Pracuj.pl', () => {
  const pracujOffer = {
    src: 'pracuj',
    id: '1005176345',
    url: 'https://www.pracuj.pl/praca/senior-front-end-developer-m-f-warszawa-prosta-68,oferta,1005176345',
  };
  // one range, the employment contract's, for both contracts
  const pracujPosting = {
    '@type': 'JobPosting',
    baseSalary: { '@type': 'MonetaryAmount', minValue: 16000, maxValue: 19000, value: 19000, currency: 'PLN' },
    datePosted: '2026-10-23T08:23:03.78Z',
    validThrough: '2026-11-22T22:59:59Z',
    employmentType: 'umowa o pracę, kontrakt B2B',
    experienceRequirements:
      'Bardzo dobrze znasz React oraz TypeScript, Znasz zasady projektowania i integracji z REST API',
    hiringOrganization: 'eRecruitment Solutions sp.z.o.o.',
  };
  const unitOf = (id: number, short: string, long: string) => ({
    id,
    shortForm: { name: short, pracujPlName: short },
    longForm: { name: long, pracujPlName: long },
  });
  const currency = { code: 'PLN', symbol: 'zł' };
  const typesOfContracts = [
    {
      id: 0,
      name: 'umowa o pracę',
      salary: {
        currency,
        from: 16000,
        to: 19000,
        salaryKind: { code: 'gross', name: 'brutto' },
        timeUnit: unitOf(0, 'mies.', 'miesięcznie'),
      },
    },
    {
      id: 3,
      name: 'kontrakt B2B',
      salary: {
        currency,
        from: 90,
        to: 125,
        salaryKind: { code: 'net-plus-vat', name: 'netto (+ VAT)' },
        timeUnit: unitOf(1, 'godz.', 'godzinowo'),
      },
    },
  ];
  // its offer is the data of the page's dehydrated "jobOffer" query, after others
  const pracujPage = (contracts: object[]) =>
    `<html><head><script type="application/ld+json">${JSON.stringify(pracujPosting)}</script></head><body>` +
    `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({
      props: {
        pageProps: {
          dehydratedState: {
            queries: [
              { queryKey: ['user'], state: { data: null } },
              {
                queryKey: ['jobOffer', '1005176345', 'pl'],
                state: {
                  data: { jobOfferWebId: 1005176345, attributes: { employment: { typesOfContracts: contracts } } },
                },
              },
            ],
          },
        },
      },
    })}</script></body></html>`;

  it("each contract's salary, not the JobPosting's one range", async () => {
    answer(pracujPage(typesOfContracts));
    expect((await scrapeOffer(pracujOffer)).details).toMatchObject({
      salary: '16 000–19 000 PLN gross / month (UoP); 90–125 PLN net + VAT / hour (B2B)',
      contract: 'Permanent (UoP), B2B',
      posted: '2026-10-23',
      validUntil: '2026-11-22',
      company: 'eRecruitment Solutions sp.z.o.o.',
    });
  });

  it("no data in the page: the JobPosting's", async () => {
    answer(pracujPage([]));
    expect((await scrapeOffer(pracujOffer)).details).toMatchObject({
      salary: '16 000–19 000 PLN',
      contract: 'umowa o pracę, kontrakt B2B',
    });
  });
});
