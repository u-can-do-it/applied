import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { ScraperConfig } from '@/lib/listings/config';
import { valuesAt } from '@/lib/listings/extract';
import type { KindId } from '@/lib/listings/kinds';
import { parseBody } from '@/lib/listings/parse';

// One recorded response per built-in board (test/fixtures/, trimmed to a few offers). The snapshot
// holds the whole parsed output, so a parser change or a re-recorded fixture shows up in the diff.

const fixture = (name: string) => readFileSync(new URL(`../../fixtures/${name}`, import.meta.url), 'utf8');
const parse = (kind: KindId, body: string, url = 'https://example.com/list', config: Partial<ScraperConfig> = {}) =>
  parseBody(kind, body, { src: kind, url, config: { url, ...config } });

describe('built-in board parsers', () => {
  it('justjoin: the candidate API', () => {
    const result = parse('justjoin', fixture('justjoin.json'));
    expect(result.total).toBe(3);
    expect(result.items).toHaveLength(3);
    const [first] = result.items;
    expect(first.src).toBe('justjoin');
    expect(first.url).toBe(`https://justjoin.it/job-offer/${first.id}`);
    expect(typeof first.sort).toBe('number');
    expect(result.sample).toContain(`"slug": "${first.id}"`);
    // the offer's city is also among its locations[]: listed once
    expect(first.locations).toEqual(['Katowice (Śląskie)']);
    expect(result.items).toMatchSnapshot();
  });

  it('nofluff: the serverApp-state in the listing page', () => {
    const result = parse('nofluff', fixture('nofluff.html'));
    expect(result.total).toBe(3);
    expect(result.items).toHaveLength(3);
    for (const offer of result.items) expect(offer.url).toMatch(/^https:\/\/nofluffjobs\.com\/pl\/job\/[^/]+$/);
    expect(result.items).toMatchSnapshot();
  });

  it('solidjobs: the public API', () => {
    const result = parse('solidjobs', fixture('solidjobs.json'));
    expect(result.total).toBe(3);
    expect(result.items).toHaveLength(3);
    for (const offer of result.items) expect(offer.url).toMatch(/^https:\/\/solid\.jobs\//);
    expect(result.items).toMatchSnapshot();
  });

  it('bulldog: __NEXT_DATA__', () => {
    const result = parse('bulldog', fixture('bulldog.html'));
    expect(result.total).toBe(3);
    expect(result.items).toHaveLength(3);
    for (const offer of result.items) {
      expect(offer.url).toBe(`https://bulldogjob.pl/companies/jobs/${offer.id}`);
      expect(offer.sort).toBe(Number(offer.id.split('-')[0]));
    }
    expect(result.items).toMatchSnapshot();
  });

  it('eldorado: the app router flight data, split over chunks', () => {
    const result = parse('eldorado', fixture('eldorado.html'));
    expect(result.total).toBe(3);
    expect(result.items).toHaveLength(3);
    for (const offer of result.items) {
      expect(offer.url).toMatch(new RegExp(`^https://czyjesteldorado\\.pl/praca/${offer.id}-`));
      expect(offer.sort).toBe(Number(offer.id));
      expect(offer.skills.length).toBeGreaterThan(0);
    }
    // the keywords, then the categories (ids, read as words)
    expect(result.items[0].skills).toEqual([
      'Azure DevOps',
      'ASP.NET Core MVC',
      'JavaScript',
      'React.js',
      'Angular',
      'Git',
      'Microsoft SQL Server',
      'PostgreSQL',
      'project management',
      'agile',
    ]);
    expect(result.items).toMatchSnapshot();
  });

  it('builtin: the job cards', () => {
    const result = parse('builtin', fixture('builtin.html'));
    expect(result.total).toBe(2);
    expect(result.items).toHaveLength(2);
    for (const offer of result.items) {
      expect(offer.url).toMatch(new RegExp(`^https://builtin\\.com/job/.+/${offer.id}$`));
      expect(offer.sort).toBe(Number(offer.id));
    }
    expect(result.sample).toMatch(/^<div id="job-card-\d+/);
    // "Staff …" is senior, as on LinkedIn
    expect(result.items[0].title).toMatch(/^Staff /);
    expect(result.items[0].seniority).toBe('senior');
    expect(result.items).toMatchSnapshot();
  });

  it('linkedin: the guest search fragment', () => {
    const url =
      'https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search?keywords=React&location=Warszawa';
    const result = parse('linkedin', fixture('linkedin.html'), url);
    expect(result.total).toBe(3);
    expect(result.items).toHaveLength(3);
    for (const offer of result.items) {
      expect(offer.url).toBe(`https://www.linkedin.com/jobs/view/${offer.id}`);
      expect(offer.sort).toBeUndefined();
    }
    expect(result.items).toMatchSnapshot();
  });
});

describe('board parser edge cases', () => {
  it('a remote-only LinkedIn search marks every card remote', () => {
    const url = 'https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search?keywords=React&f_WT=2&start=0';
    const result = parse('linkedin', fixture('linkedin.html'), url);
    expect(result.items.every((offer) => offer.remote)).toBe(true);
  });

  it('past the last LinkedIn page: no results, not an error', () => {
    expect(parse('linkedin', '<!DOCTYPE html><!---->')).toEqual({ total: 0, items: [] });
    expect(() => parse('linkedin', '<html><body>Sign in to continue</body></html>')).toThrow(/no job cards/);
  });

  it('says what is wrong with a page it cannot read', () => {
    expect(() => parse('justjoin', '{"items":[]}')).toThrow('JustJoin API: no data list (got items)');
    expect(() => parse('justjoin', '<html>')).toThrow(/is not JSON/);
    expect(() => parse('nofluff', '<html></html>')).toThrow(/no serverApp-state/);
    expect(() => parse('nofluff', '<script id="serverApp-state">{"a":{"postings":[]}}</script>')).toThrow(
      /no postings/,
    );
    expect(() => parse('solidjobs', '{}')).toThrow(/no jobs list/);
    expect(() => parse('bulldog', '<html></html>')).toThrow(/no __NEXT_DATA__/);
    expect(() => parse('bulldog', '<script id="__NEXT_DATA__">{"props":{}}</script>')).toThrow(/is not a list/);
    expect(() => parse('eldorado', '<html></html>')).toThrow(/no jobs/);
    expect(() => parse('builtin', '<html></html>')).toThrow(/no job cards/);
  });

  it('reads NoFluff state escaped the Angular way', () => {
    const state =
      '{&q;k&q;:{&q;body&q;:{&q;postings&q;:[{&q;id&q;:&q;x-1&q;,&q;title&q;:&q;R&a;D&q;,&q;url&q;:&q;x-1&q;,&q;seniority&q;:[&q;Senior&q;]}]}}}';
    const result = parse('nofluff', `<script id="serverApp-state" type="application/json">${state}</script>`);
    expect(result.items).toEqual([
      expect.objectContaining({
        id: 'x-1',
        title: 'R&D',
        seniority: 'senior',
        url: 'https://nofluffjobs.com/pl/job/x-1',
        remote: false,
      }),
    ]);
  });

  it('justjoin: each place once, in order', () => {
    const body = JSON.stringify({
      data: [
        {
          slug: 'a',
          title: 'A',
          city: 'Gdańsk',
          locations: [{ city: 'Warszawa' }, { city: 'Gdańsk' }, { city: 'Warszawa' }, {}],
        },
      ],
    });
    expect(parse('justjoin', body).items[0].locations).toEqual(['Gdańsk', 'Warszawa']);
  });

  it('eldorado: skills from an older page with tags only', () => {
    const jobs = [
      { id: 1, slug: 's', title: 'A', tags: ['React', { name: 'TS' }] },
      { id: 2, slug: 's', title: 'B', keywords: [], categories: [] },
    ];
    const body = `<script>self.__next_f.push([1,${JSON.stringify(JSON.stringify({ jobs }))}])</script>`;
    expect(parse('eldorado', body).items.map((offer) => offer.skills)).toEqual([['React', 'TS'], []]);
  });

  it('builtin and linkedin: the same seniority from the same title', () => {
    const titles: [string, string][] = [
      ['Staff Engineer', 'senior'],
      ['Senior React Developer', 'senior'],
      ['Tech Lead', 'senior'],
      ['Principal Engineer', 'senior'],
      ['Team Leader', 'senior'],
      ['Junior Developer', 'junior'],
      ['Software Engineering Intern', 'junior'],
      ['Interns: Frontend', 'junior'],
      ['Internship (React)', 'junior'],
      ['Summer Internships 2026', 'junior'],
      ['Graduate Developer', 'junior'],
      ['Graduates Programme', 'junior'],
      ['Trainee Developer', 'junior'],
      ['Stażysta Frontend', 'junior'],
      ['Stażystka HR', 'junior'],
      ['Zatrudnimy Stażystę', 'junior'],
      ['Program dla stażystów', 'junior'],
      ['Staż w IT', 'junior'],
      ['Internal Tools Developer', 'unknown'],
      ['International Payments Engineer', 'unknown'],
      ['Staffing Platform Developer', 'unknown'],
      ['Leadership Coach', 'unknown'],
      ['Lead Generation Specialist', 'unknown'],
      ['Seniority-free Developer', 'unknown'],
      ['React Developer', 'unknown'],
    ];
    const builtin = titles
      .map(
        ([title], i) =>
          `<div id="job-card-${i + 1}" data-id="job-card"><a data-id="job-card-title" href="/job/x/${i + 1}">${title}</a></div>`,
      )
      .join('');
    const linkedin = titles
      .map(
        ([title], i) =>
          `<li><div data-entity-urn="urn:li:jobPosting:${i + 1}"><h3 class="base-search-card__title">${title}</h3></div></li>`,
      )
      .join('');
    const expected = titles.map(([title, seniority]) => [title, seniority]);
    expect(parse('builtin', builtin).items.map((offer) => [offer.title, offer.seniority])).toEqual(expected);
    expect(parse('linkedin', linkedin).items.map((offer) => [offer.title, offer.seniority])).toEqual(expected);
  });

  it('drops offers without an id, a title or a link', () => {
    const body = JSON.stringify({
      data: [
        { slug: 'a', title: 'A' },
        { slug: '', title: 'B' },
        { slug: 'c', title: '' },
      ],
    });
    const result = parse('justjoin', body);
    expect(result.total).toBe(3);
    expect(result.items.map((offer) => offer.id)).toEqual(['a']);
  });
});

describe('generic parsers', () => {
  it('json: paths for the list and each field, {path} placeholders in the link', () => {
    const body = JSON.stringify({
      data: {
        offers: [
          {
            ref: 7,
            name: 'React Dev',
            firm: { name: 'Acme' },
            places: [{ city: 'Warszawa' }, { city: 'Kraków' }],
            mode: 'Remote',
            tags: ['React', 'TS'],
            at: '2026-10-01T10:00:00Z',
          },
          { ref: 8, name: 'No link' },
        ],
      },
    });
    const result = parse('json', body, 'https://api.example.com/jobs', {
      items: 'data.offers',
      fields: {
        id: 'ref',
        title: 'name',
        url: '/job/{ref}',
        company: 'firm',
        location: 'places[].city',
        remote: 'mode',
        skills: 'tags[]',
        date: 'at',
      },
    });
    expect(result.total).toBe(2);
    expect(result.items[0]).toEqual({
      src: 'json',
      id: '7',
      title: 'React Dev',
      company: 'Acme',
      seniority: null,
      remote: true,
      url: 'https://api.example.com/job/7',
      locations: ['Warszawa', 'Kraków'],
      skills: ['React', 'TS'],
      sort: Date.parse('2026-10-01T10:00:00Z'),
    });
    // the second has a link too ("/job/8"): the template always gives one
    expect(result.items[1].url).toBe('https://api.example.com/job/8');
  });

  it('json: a list field works with or without [] at its end', () => {
    const body = JSON.stringify([
      { t: 'A', u: '/a', tags: ['React', 'TS'], places: [{ name: 'Warszawa' }, { name: 'Kraków' }], one: 'Go' },
    ]);
    const config = (skills: string, location = '') => ({ fields: { title: 't', url: 'u', skills, location } });
    expect(parse('json', body, 'https://x.test', config('tags[]')).items[0].skills).toEqual(['React', 'TS']);
    expect(parse('json', body, 'https://x.test', config('tags')).items[0].skills).toEqual(['React', 'TS']);
    // a list of objects gives their names, a single value stays one
    expect(parse('json', body, 'https://x.test', config('one', 'places')).items[0]).toMatchObject({
      skills: ['Go'],
      locations: ['Warszawa', 'Kraków'],
    });
    // an empty list gives nothing
    expect(
      parse('json', JSON.stringify([{ t: 'A', u: '/a', tags: [] }]), 'https://x.test', config('tags')).items[0].skills,
    ).toEqual([]);
  });

  it('json: a root list needs no path; a missing path says what the JSON has', () => {
    const result = parse('json', '[{"t":"A","u":"https://x.test/a"}]', 'https://x.test', {
      fields: { title: 't', url: 'u' },
    });
    expect(result.items.map((offer) => [offer.id, offer.title])).toEqual([['https://x.test/a', 'A']]);
    expect(() => parse('json', '{"data":[],"meta":{}}')).toThrow(
      'Give the path to the list of offers (the JSON has: data, meta)',
    );
    expect(() => parse('json', '{"data":[]}', undefined, { items: 'data' })).toThrow(/Nothing at "data"/);
  });

  it('json: __NEXT_DATA__, ld+json and a script by id', () => {
    const next = '<script id="__NEXT_DATA__" type="application/json">{"props":{"jobs":[{"t":"A","u":"/a"}]}}</script>';
    const fields = { title: 't', url: 'u' };
    expect(parse('json', next, 'https://x.test', { from: 'next-data', items: 'props.jobs', fields }).items[0].url).toBe(
      'https://x.test/a',
    );
    const ld =
      '<script type="application/ld+json">{"t":"A","u":"/a"}</script><script type="application/ld+json">broken</script>';
    expect(
      parse('json', ld, 'https://x.test', { from: 'ld-json', items: '[]', fields }).items.map((offer) => offer.title),
    ).toEqual(['A']);
    const script = '<script id="state">{&q;jobs&q;:[{&q;t&q;:&q;A&q;,&q;u&q;:&q;/a&q;}]}</script>';
    expect(
      parse('json', script, 'https://x.test', { from: 'script', scriptId: 'state', items: 'jobs', fields }).items,
    ).toHaveLength(1);
    expect(() => parse('json', script, 'https://x.test', { from: 'script', items: 'jobs' })).toThrow(/Give the id/);
  });

  it('html: CSS selectors, @attr for an attribute', () => {
    const body = `<ul>
      <li class="job" data-id="1"><a class="t" href="/j/1"> React
        Dev </a><span class="c">Acme</span><span class="loc">Warszawa</span><span class="loc">Remote</span></li>
      <li class="job" data-id="2"><a class="t" href="https://other.test/j/2">Vue Dev</a></li>
    </ul>`;
    const result = parse('html', body, 'https://board.test/search', {
      items: 'li.job',
      fields: { id: '@data-id', title: 'a.t', url: 'a.t@href', company: '.c', location: '.loc', remote: '.loc' },
    });
    expect(
      result.items.map((offer) => [offer.id, offer.title, offer.url, offer.company, offer.remote, offer.locations]),
    ).toEqual([
      ['1', 'React Dev', 'https://board.test/j/1', 'Acme', true, ['Warszawa', 'Remote']],
      ['2', 'Vue Dev', 'https://other.test/j/2', null, false, []],
    ]);
    expect(() => parse('html', body, undefined, { items: 'div.none' })).toThrow(/No "div.none" in the page/);
    expect(() => parse('html', body)).toThrow(/Give the CSS selector/);
  });

  it('rss: RSS items and Atom entries', () => {
    const rss = `<rss><channel>
      <item><title><![CDATA[Remote React Dev]]></title><link>https://x.test/1</link><guid>g1</guid>
        <dc:creator>Acme</dc:creator><category>React</category><category>TS</category><pubDate>Thu, 01 Oct 2026 10:00:00 GMT</pubDate></item>
    </channel></rss>`;
    expect(parse('rss', rss).items).toEqual([
      {
        src: 'rss',
        id: 'g1',
        title: 'Remote React Dev',
        company: 'Acme',
        seniority: null,
        remote: true,
        url: 'https://x.test/1',
        locations: [],
        skills: ['React', 'TS'],
        sort: Date.parse('2026-10-01T10:00:00Z'),
      },
    ]);
    const atom = `<feed><entry><title>Dev &amp; Ops</title><link href="/e/1"/><id>e1</id><author><name>Beta</name></author>
      <updated>2026-10-01T10:00:00Z</updated></entry></feed>`;
    expect(parse('rss', atom, 'https://feed.test/atom').items[0]).toMatchObject({
      id: 'e1',
      title: 'Dev & Ops',
      url: 'https://feed.test/e/1',
      company: 'Beta',
    });
    expect(() => parse('rss', '<rss></rss>')).toThrow(/No <item> or <entry>/);
  });
});

describe('valuesAt', () => {
  const root = { data: { list: [{ city: 'A' }, { city: 'B' }, {}] }, n: 0 };

  it('walks dotted paths, [] for each item and [i] for one', () => {
    expect(valuesAt(root, 'data.list[].city')).toEqual(['A', 'B']);
    expect(valuesAt(root, 'data.list[1].city')).toEqual(['B']);
    expect(valuesAt(root, 'n')).toEqual([0]);
  });

  it('an empty path is the root; a missing part gives nothing', () => {
    expect(valuesAt(root, '')).toEqual([root]);
    expect(valuesAt(root, undefined)).toEqual([root]);
    expect(valuesAt(root, 'data.nope.city')).toEqual([]);
    expect(valuesAt(root, 'data.list[5]')).toEqual([]);
    expect(valuesAt(root, 'a]b')).toEqual([]);
  });
});
