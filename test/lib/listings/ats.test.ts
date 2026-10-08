import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { boardOf } from '@/lib/boards';
import { atsApiUrl, atsOf } from '@/lib/listings/ats';
import { parseBody } from '@/lib/listings/parse';
import { remoteHere } from '@/lib/listings/parsers/ats';

// One recorded API response per ATS (test/fixtures/ats-*.json, trimmed by trim-ats.cjs to 3 jobs that show
// the cases below). The snapshot holds the whole parsed output.

const fixture = (name: string) => readFileSync(new URL(`../../fixtures/${name}`, import.meta.url), 'utf8');
const parse = (url: string, body: string) => {
  const ats = atsOf(url);
  if (!ats) throw new Error(`not an ATS link: ${url}`);
  return parseBody('ats', body, { src: ats.id, url, config: { url } });
};

describe('atsOf: the careers link -> the ATS, the company and its API', () => {
  it.each([
    ['https://job-boards.greenhouse.io/gitlab', 'greenhouse', 'https://boards-api.greenhouse.io/v1/boards/gitlab/jobs'],
    [
      'https://boards.greenhouse.io/gitlab/jobs/8860302002',
      'greenhouse',
      'https://boards-api.greenhouse.io/v1/boards/gitlab/jobs',
    ],
    [
      'https://boards.greenhouse.io/embed/job_board?for=gitlab',
      'greenhouse',
      'https://boards-api.greenhouse.io/v1/boards/gitlab/jobs',
    ],
    ['https://jobs.lever.co/spotify', 'lever', 'https://api.lever.co/v0/postings/spotify?mode=json'],
    ['https://jobs.eu.lever.co/acme/1234-abcd', 'lever', 'https://api.eu.lever.co/v0/postings/acme?mode=json'],
    ['https://jobs.ashbyhq.com/elevenlabs', 'ashbyhq', 'https://api.ashbyhq.com/posting-api/job-board/elevenlabs'],
    [
      'https://apply.workable.com/huggingface/',
      'workable',
      'https://apply.workable.com/api/v1/widget/accounts/huggingface',
    ],
    [
      'https://careers.smartrecruiters.com/BoschGroup',
      'smartrecruiters',
      'https://api.smartrecruiters.com/v1/companies/BoschGroup/postings?limit=100',
    ],
    // the link's own country / city / q narrow a big company's jobs; the rest of its query is left out
    [
      'https://jobs.smartrecruiters.com/BoschGroup/744000154435119?country=pl&utm_source=x',
      'smartrecruiters',
      'https://api.smartrecruiters.com/v1/companies/BoschGroup/postings?limit=100&country=pl',
    ],
  ])('%s', (link, id, api) => {
    expect(atsOf(link)).toMatchObject({ id, api });
    expect(atsApiUrl(link)).toBe(api);
  });

  it('its id is what boardOf() calls the links to its jobs', () => {
    for (const link of [
      'https://job-boards.greenhouse.io/gitlab/jobs/8860302002',
      'https://jobs.lever.co/spotify/2193db3f-77c5-43b8-b030-8f92c9882bf1',
      'https://jobs.ashbyhq.com/elevenlabs/a571b8e4-8176-4e31-aab6-2287ee810236',
      'https://apply.workable.com/huggingface/j/81B46579FE',
      'https://jobs.smartrecruiters.com/BoschGroup/744000154435119',
    ])
      expect(atsOf(link)?.id).toBe(boardOf(link));
  });

  it('no ATS: another site, no company in the link, a link that is not one', () => {
    for (const link of [
      'https://justjoin.it/job-offer/acme-react',
      'https://job-boards.greenhouse.io/',
      'https://apply.workable.com/j/81B46579FE',
      'https://evil.example/jobs.lever.co/acme',
      'jobs.lever.co/acme',
    ])
      expect(atsOf(link)).toBeNull();
    expect(() => atsApiUrl('https://example.com/careers')).toThrow(
      'Not a careers page on Greenhouse, Lever, Ashby, Workable or SmartRecruiters',
    );
  });
});

describe('remoteHere: remote from where you are', () => {
  it('remote with no place, from Poland, or Europe-wide', () => {
    expect(remoteHere(true, [])).toBe(true);
    expect(remoteHere(true, ['Remote'])).toBe(true);
    expect(remoteHere(true, ['Remote, Canada', 'Remote, Poland'])).toBe(true);
    expect(remoteHere(true, ['Europe'])).toBe(true);
    expect(remoteHere(true, ['Remote - EMEA'])).toBe(true);
    expect(remoteHere(true, ['Warszawa, Polska'])).toBe(true);
  });

  it('remote only from other countries is not; nor is a job that is not remote', () => {
    expect(remoteHere(true, ['Remote, France'])).toBe(false);
    expect(remoteHere(true, ['New York, NY'])).toBe(false);
    expect(remoteHere(true, ['Remote Ireland', 'Remote, United Kingdom'])).toBe(false);
    expect(remoteHere(false, ['Remote, Poland'])).toBe(false);
  });

  it('the title can say where: "EMEA Remote" with Paris as its place', () => {
    expect(remoteHere(true, ['Paris, France'], 'Machine Learning Engineer - EMEA Remote')).toBe(true);
    expect(remoteHere(true, ['Paris, France'], 'Machine Learning Engineer - US Remote')).toBe(false);
  });
});

describe('ATS parsers', () => {
  it('greenhouse: its places one by one; remote from Poland among others, from France only, an office', () => {
    const result = parse('https://job-boards.greenhouse.io/gitlab', fixture('ats-greenhouse.json'));
    expect(result.total).toBe(3);
    const [poland, france, office] = result.items;
    expect(poland).toMatchObject({
      src: 'greenhouse',
      company: 'GitLab',
      remote: true,
      locations: ['Remote, Canada', 'Remote, Poland', 'Remote, United Kingdom'],
    });
    expect(poland.url).toBe(`https://job-boards.greenhouse.io/gitlab/jobs/${poland.id}`);
    expect(france).toMatchObject({ remote: false, locations: ['Remote, France'] });
    expect(office).toMatchObject({ remote: false, locations: ['Bangalore, India'] });
    for (const offer of result.items) {
      expect(offer.skills).toEqual([]);
      expect(offer.sort).toBeUndefined();
    }
    expect(result.items).toMatchSnapshot();
  });

  it('lever: no company name in the API, so the one in the link', () => {
    const result = parse('https://jobs.lever.co/spotify', fixture('ats-lever.json'));
    expect(result.total).toBe(3);
    const [remote, hybrid] = result.items;
    expect(remote).toMatchObject({ src: 'lever', company: 'Spotify', remote: false, locations: ['New York, NY'] });
    expect(hybrid).toMatchObject({ remote: false, locations: ['London', 'Stockholm'] });
    for (const offer of result.items) expect(offer.url).toBe(`https://jobs.lever.co/spotify/${offer.id}`);
    // the Settings test's sample: its long descriptions cut short
    expect(result.sample?.length).toBeLessThan(3000);
    expect(result.items).toMatchSnapshot();
  });

  it('ashby: the main place with its country and the secondary ones; the workplace type says remote', () => {
    const result = parse('https://jobs.ashbyhq.com/elevenlabs', fixture('ats-ashbyhq.json'));
    expect(result.total).toBe(3);
    const [europe, india, office] = result.items;
    expect(europe).toMatchObject({
      src: 'ashbyhq',
      company: 'Elevenlabs',
      remote: true,
      locations: ['Europe, European Union', 'Germany', 'United Kingdom', 'France'],
    });
    expect(india.remote).toBe(false);
    expect(office.remote).toBe(false);
    expect(result.items).toMatchSnapshot();
  });

  it('ashby: a job left off the job board is left out', () => {
    const data = JSON.parse(fixture('ats-ashbyhq.json')) as { jobs: { isListed: boolean }[] };
    data.jobs[0].isListed = false;
    const result = parse('https://jobs.ashbyhq.com/elevenlabs', JSON.stringify(data));
    expect(result.total).toBe(2);
  });

  it("workable: the account's name, each place with its country", () => {
    const result = parse('https://apply.workable.com/huggingface/', fixture('ats-workable.json'));
    expect(result.total).toBe(3);
    const [emea, us] = result.items;
    expect(emea).toMatchObject({ src: 'workable', company: 'Hugging Face', remote: true });
    expect(emea.locations[0]).toBe('Paris, France');
    expect(us.remote).toBe(false);
    for (const offer of result.items) expect(offer.url).toBe(`https://apply.workable.com/j/${offer.id}`);
    expect(result.items).toMatchSnapshot();
  });

  it("smartrecruiters: the job's page, not the API's link", () => {
    const result = parse(
      'https://careers.smartrecruiters.com/BoschGroup?country=pl',
      fixture('ats-smartrecruiters.json'),
    );
    expect(result.total).toBe(3);
    const [intern] = result.items;
    expect(intern).toMatchObject({
      src: 'smartrecruiters',
      company: 'Bosch Group',
      seniority: 'junior',
      remote: false,
      locations: ['Warszawa, Województwo mazowieckie, Poland'],
      url: `https://jobs.smartrecruiters.com/BoschGroup/${intern.id}`,
    });
    expect(result.items).toMatchSnapshot();
  });

  it('says what is wrong with an answer it cannot read', () => {
    expect(() => parse('https://jobs.lever.co/acme', '{"ok":false,"error":"Document not found"}')).toThrow(
      'Lever: no jobs list (got ok, error)',
    );
    expect(() => parse('https://jobs.ashbyhq.com/acme', '<html>')).toThrow('The Ashby answer is not JSON');
  });
});
