import { afterEach, describe, expect, it, vi } from 'vitest';
import { scrapeOffer } from '@/lib/ads';

// Bulldog's ad: the page's JobPosting, else its __NEXT_DATA__ (some of its pages come without a JobPosting).
// The job's fields are those of a page recorded 2026-10-19, its texts cut short.

const answer = (html: string) =>
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve(new Response(html))),
  );
afterEach(() => {
  vi.unstubAllGlobals();
});

const offer = {
  src: 'bulldog',
  id: '258799-senior-product-engineer',
  url: 'https://bulldogjob.pl/companies/jobs/258799',
};

const job = {
  position: 'Senior Product Engineer (TS/NodeJS/Vue)',
  technologyTags: ['Node.js', 'Vue.js', 'React'],
  minExperienceInYears: 5,
  requirements: '<h4>Must-haves</h4>\n<ul>\n<li>Fullstack JavaScript/TypeScript experience</li>\n</ul>',
  details: '<h4>About n8n</h4>\n<p>n8n is the open workflow orchestration platform built for the new era of AI.</p>',
  offer: '<h4>What we offer</h4>\n<ul><li>Competitive compensation</li></ul>',
  contractB2b: false,
  contractEmployment: true,
  contractOther: false,
  employmentSalary: {
    currency: 'EUR',
    hidden: false,
    maxValue: null,
    minValue: null,
    money: 'From 72 800',
    timeframe: 'year',
  },
  b2bSalary: null,
  otherSalary: null,
  workModes: ['on-site', 'full-remote'],
  locations: [
    { location: { cityPl: 'Berlin', cityEn: 'Berlin' } },
    { location: { cityPl: 'Londyn', cityEn: 'London' } },
  ],
  publishedAt: '2026-10-19T14:07:02+02:00',
  endsAt: '2026-11-18T23:59:59+01:00',
  company: { name: 'n8n' },
};
const page = (data: object, head = '') =>
  `<html><head>${head}</head><body><script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { pageProps: data } })}</script></body></html>`;

describe('Bulldog', () => {
  it('a page without a JobPosting: the ad and its details from the page data', async () => {
    answer(page({ metaData: { jsonLd: null }, data: { job } }));
    const ad = await scrapeOffer(offer);
    expect(ad.status).toBe('ok');
    expect(ad.text).toBe(
      [
        'Skills: Node.js, Vue.js, React',
        'Experience: 5+ years',
        'Must-haves\n• Fullstack JavaScript/TypeScript experience',
        'About n8n\n\nn8n is the open workflow orchestration platform built for the new era of AI.',
        'What we offer\n• Competitive compensation',
      ].join('\n\n'),
    );
    expect(ad.details).toEqual({
      salary: 'From 72 800 EUR / year (UoP)',
      contract: 'Employment contract (UoP)',
      location: 'Berlin, London',
      remote: true,
      workMode: 'remote',
      posted: '2026-10-19',
      validUntil: '2026-11-18',
      company: 'n8n',
    });
  });

  it('a page with a JobPosting: that, as for any board', async () => {
    const posting = {
      '@type': 'JobPosting',
      description:
        '<p>The JobPosting’s own ad text, long enough to be an ad: the AI reads it, the window shows it.</p>',
    };
    answer(page({ data: { job } }, `<script type="application/ld+json">${JSON.stringify(posting)}</script>`));
    expect((await scrapeOffer(offer)).text).toBe(
      'The JobPosting’s own ad text, long enough to be an ad: the AI reads it, the window shows it.',
    );
  });

  it('neither: no ad text', async () => {
    answer(page({ data: { job: null } }));
    expect((await scrapeOffer(offer)).status).toBe('empty');
    answer('<html><body>Nothing here</body></html>');
    expect((await scrapeOffer(offer)).status).toBe('empty');
  });
});
