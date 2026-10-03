import { describe, expect, it } from 'vitest';
import {
  areaTest,
  expandUrl,
  fold,
  keywordTest,
  MAX_PAGES,
  placeOf,
  titleTest,
  type Found,
} from '@/lib/scraping/match';

const offer = (o: Partial<Found> = {}): Found => ({
  src: 'test',
  id: '1',
  title: 'Developer',
  company: null,
  seniority: null,
  remote: false,
  url: 'https://x.test/1',
  locations: [],
  skills: [],
  ...o,
});

describe('fold', () => {
  it('lowercases and drops accents', () => {
    expect(fold('Kraków')).toBe('krakow');
    expect(fold('ŚLĄSK Gdańsk Zielona Góra')).toBe('slask gdansk zielona gora');
    expect(fold('Crème Brûlée')).toBe('creme brulee');
  });

  it('letters with a stroke too, which have no accent to drop', () => {
    expect(fold('Łódź')).toBe('lodz');
    expect(fold('Wrocław')).toBe('wroclaw');
    expect(fold('BIAŁYSTOK')).toBe('bialystok');
    expect(fold('København Đakovo Straße ẞ Æsir Œuvre')).toBe('kobenhavn dakovo strasse ss aesir oeuvre');
  });

  it('so a city typed without them matches', () => {
    expect(areaTest({ cities: ['lodz'], remoteOk: false })(offer({ locations: ['Łódź'] }))).toBe(true);
    expect(areaTest({ cities: ['Łódź'], remoteOk: false })(offer({ locations: ['Lodz, Poland'] }))).toBe(true);
    expect(keywordTest(['wroclaw'])(['Praca we Wrocławiu'])).toBe(true);
    expect(expandUrl('https://x.test/{keyword_slug}', ['Łódź']).map((u) => u.url)).toEqual(['https://x.test/lodz']);
  });
});

describe('keywordTest', () => {
  it('a keyword must start a word', () => {
    const react = keywordTest(['React']);
    for (const t of ['React', 'ReactJS', 'React.js', 'Senior react developer', 'Frontend (React/TS)', 'react-native']) {
      expect(react([t]), t).toBe(true);
    }
    for (const t of ['Preact', 'Angular', '']) expect(react([t]), t).toBe(false);
  });

  it('matches any of the texts and any of the keywords, accents ignored', () => {
    const test = keywordTest(['Vue', 'Kraków']);
    expect(test(['Frontend', 'vue.js'])).toBe(true);
    expect(test(['Praca w Krakowie'])).toBe(true);
    expect(test(['Frontend', 'Angular'])).toBe(false);
    expect(test([])).toBe(false);
  });

  it('c#, c++ and .net are words of their own; regex characters are literal', () => {
    expect(keywordTest(['C#'])(['Senior C# Developer'])).toBe(true);
    expect(keywordTest(['C++'])(['C++17 engineer'])).toBe(true);
    expect(keywordTest(['C++'])(['Ccc'])).toBe(false);
    expect(keywordTest(['Node.js'])(['NodeXjs'])).toBe(false);
    expect(keywordTest(['.NET'])(['.NET developer'])).toBe(true);
    // the "+" and "#" before a keyword count as part of a word
    expect(keywordTest(['net'])(['c#net'])).toBe(false);
    // only titleTest lets ".net" match inside "ASP.NET": "p" is a letter in front of it
    expect(keywordTest(['.NET'])(['ASP.NET Core'])).toBe(false);
  });

  it('no keywords (or only blanks): everything passes', () => {
    expect(keywordTest([])(['anything'])).toBe(true);
    expect(keywordTest(['  ', ''])(['anything'])).toBe(true);
  });
});

describe('titleTest', () => {
  it('a whole word: java is not JavaScript, go is not Google', () => {
    const test = titleTest(['java', 'go']);
    expect(test('Java Developer')).toBe(true);
    expect(test('Senior Developer (Java/Kotlin)')).toBe(true);
    expect(test('Go / Golang Engineer')).toBe(true);
    expect(test('JavaScript Developer')).toBe(false);
    expect(test('Google Ads Specialist')).toBe(false);
    expect(test('Golang Engineer')).toBe(false);
    // a dot right after the word counts as part of it ("Node.js"), even at the end of a sentence
    expect(test('Java.')).toBe(false);
  });

  it('.net also matches ASP.NET and a bare "net"', () => {
    const test = titleTest(['.net']);
    expect(test('.NET Developer')).toBe(true);
    expect(test('ASP.NET Core Developer')).toBe(true);
    expect(test('Senior Net Developer')).toBe(true);
    expect(test('Network Engineer')).toBe(false);
    expect(test('Dotnet Developer')).toBe(false);
  });

  it('c++ and phrases', () => {
    expect(titleTest(['c++'])('Senior C++ Engineer')).toBe(true);
    expect(titleTest(['c++'])('C++20 Engineer')).toBe(false);
    expect(titleTest(['react native'])('React Native Developer')).toBe(true);
    expect(titleTest(['react native'])('React Developer')).toBe(false);
  });

  it('no terms: nothing matches', () => {
    expect(titleTest([])('Java Developer')).toBe(false);
    expect(titleTest([' '])('Java Developer')).toBe(false);
  });
});

describe('areaTest', () => {
  const warsaw = { cities: ['warszaw', 'Kraków'], remoteOk: true };

  it('no cities: remote decides', () => {
    expect(areaTest({ cities: [], remoteOk: true })(offer({ remote: true }))).toBe(true);
    expect(areaTest({ cities: [], remoteOk: true })(offer())).toBe(true);
    expect(areaTest({ cities: [], remoteOk: false })(offer({ remote: true }))).toBe(false);
    expect(areaTest({ cities: [' '], remoteOk: false })(offer())).toBe(true);
  });

  it('with cities: an office offer must be in one, part of the name is enough', () => {
    const test = areaTest(warsaw);
    expect(test(offer({ locations: ['Warszawa'] }))).toBe(true);
    expect(test(offer({ locations: ['Gdańsk', 'Warszawie'] }))).toBe(true);
    expect(test(offer({ locations: ['KRAKOW'] }))).toBe(true);
    expect(test(offer({ locations: ['Gdańsk'] }))).toBe(false);
    // an offer that doesn't say where passes
    expect(test(offer({ locations: [] }))).toBe(true);
  });

  it('with cities: a remote offer passes if remote is ok, else only in a city', () => {
    expect(areaTest(warsaw)(offer({ remote: true, locations: ['Gdańsk'] }))).toBe(true);
    const noRemote = areaTest({ ...warsaw, remoteOk: false });
    expect(noRemote(offer({ remote: true, locations: ['Gdańsk'] }))).toBe(false);
    expect(noRemote(offer({ remote: true, locations: ['Warszawa'] }))).toBe(true);
    expect(noRemote(offer({ remote: true, locations: [] }))).toBe(false);
  });
});

describe('placeOf', () => {
  it('the matching city, else the first, else null', () => {
    expect(placeOf(offer({ locations: ['Gdańsk', 'Warszawa'] }), ['warszaw'])).toBe('Warszawa');
    expect(placeOf(offer({ locations: ['Gdańsk', 'Poznań'] }), ['warszaw'])).toBe('Gdańsk');
    expect(placeOf(offer({ locations: ['Gdańsk'] }), [])).toBe('Gdańsk');
    expect(placeOf(offer(), ['warszaw'])).toBeNull();
  });
});

describe('expandUrl', () => {
  it('without placeholders: just the link', () => {
    expect(expandUrl('https://x.test/jobs', ['React'], 3)).toEqual([
      { url: 'https://x.test/jobs', keyword: null, page: 1 },
    ]);
  });

  it('one link per keyword, encoded or as a slug', () => {
    expect(expandUrl('https://x.test/?q={keyword}', ['React', 'C# / .NET']).map((u) => u.url)).toEqual([
      'https://x.test/?q=React',
      'https://x.test/?q=C%23%20%2F%20.NET',
    ]);
    expect(expandUrl('https://x.test/{keyword_slug}', ['Node.js', 'Kraków Senior', 'C#']).map((u) => u.url)).toEqual([
      'https://x.test/node-js',
      'https://x.test/krakow-senior',
      'https://x.test/c',
    ]);
  });

  it('{keyword} without keywords is an error', () => {
    expect(() => expandUrl('https://x.test/?q={keyword}', [])).toThrow(/no keywords/);
    expect(() => expandUrl('https://x.test/{keyword_slug}', [])).toThrow(/no keywords/);
  });

  it('pages: {start} counts by 10, {page} from 1; keyword-major order', () => {
    expect(expandUrl('https://x.test/?q={keyword}&start={start}', ['a', 'b'], 2)).toEqual([
      { url: 'https://x.test/?q=a&start=0', keyword: 'a', page: 1 },
      { url: 'https://x.test/?q=a&start=10', keyword: 'a', page: 2 },
      { url: 'https://x.test/?q=b&start=0', keyword: 'b', page: 1 },
      { url: 'https://x.test/?q=b&start=10', keyword: 'b', page: 2 },
    ]);
    expect(expandUrl('https://x.test/?p={page}', [], 3).map((u) => u.url)).toEqual([
      'https://x.test/?p=1',
      'https://x.test/?p=2',
      'https://x.test/?p=3',
    ]);
  });

  it('the page count is clamped to 1..MAX_PAGES and rounded down', () => {
    const count = (pages: number) => expandUrl('https://x.test/?p={page}', [], pages).length;
    expect(count(99)).toBe(MAX_PAGES);
    expect(count(0)).toBe(1);
    expect(count(-3)).toBe(1);
    expect(count(Number.NaN)).toBe(1);
    expect(count(2.9)).toBe(2);
  });
});
