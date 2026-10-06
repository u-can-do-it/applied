import { describe, expect, it } from 'vitest';
import { BOARD_RE, BOARD_SUGGESTIONS, boardIdOf, boardOf, cleanLink, isLink } from '@/lib/boards';

describe('isLink', () => {
  it('only http(s) URLs', () => {
    expect(isLink('https://justjoin.it/job-offer/x')).toBe(true);
    expect(isLink('  http://x.test  ')).toBe(true);
    expect(isLink('ftp://x.test/file')).toBe(false);
    expect(isLink('javascript:alert(1)')).toBe(false);
    expect(isLink('justjoin.it/job-offer/x')).toBe(false);
    expect(isLink('')).toBe(false);
  });
});

describe('boardOf', () => {
  it('knows the boards by host, with or without www or a subdomain', () => {
    const cases: [string, string][] = [
      ['https://justjoin.it/job-offer/acme-react-dev', 'justjoin'],
      ['https://nofluffjobs.com/pl/job/react-dev-acme-warszawa', 'nofluff'],
      ['https://solid.jobs/offer/123/react', 'solidjobs'],
      ['https://bulldogjob.pl/companies/jobs/123-react', 'bulldog'],
      ['https://czyjesteldorado.pl/praca/449389-scrum-master', 'eldorado'],
      ['https://builtin.com/job/react-dev/123', 'builtin'],
      ['https://www.linkedin.com/jobs/view/4123456789', 'linkedin'],
      ['https://pl.linkedin.com/jobs/view/4123456789', 'linkedin'],
      ['https://himalayas.app/companies/oversee/jobs/senior-react-dev', 'himalayas'],
      ['https://theprotocol.it/szczegoly/praca/react', 'theprotocol'],
      ['https://www.pracuj.pl/praca/react,oferta,1004', 'pracuj'],
      ['https://rocketjobs.pl/oferta/x', 'rocketjobs'],
      ['https://pl.indeed.com/viewjob?jk=abc', 'indeed'],
      ['https://www.olx.pl/oferta/praca/x.html', 'olx'],
      ['HTTPS://WWW.JUSTJOIN.IT/job-offer/x', 'justjoin'],
    ];
    for (const [link, board] of cases) expect(boardOf(link), link).toBe(board);
  });

  it('does not take a look-alike host for a board', () => {
    expect(boardOf('https://notjustjoin.it/x')).toBe('notjustjoin');
    expect(boardOf('https://justjoin.it.evil.test/x')).toBe('evil');
  });

  it('an employer page opened from Eldorado counts as Eldorado', () => {
    expect(boardOf('https://careers.acme.com/jobs/1?utm_source=czyjesteldorado.pl')).toBe('eldorado');
    expect(boardOf('https://careers.acme.com/jobs/1?ref=CzyJestEldorado')).toBe('eldorado');
  });

  it('other sites by their name', () => {
    expect(boardOf('https://job-boards.greenhouse.io/acme/jobs/1')).toBe('greenhouse');
    expect(boardOf('https://jobs.lever.co/acme/1')).toBe('lever');
    expect(boardOf('http://localhost:3000/x')).toBe('localhost');
  });

  it('a two-part ending is not the name', () => {
    expect(boardOf('https://jobs.acme.co.uk/1')).toBe('acme');
    expect(boardOf('https://www.acme.com.pl/kariera')).toBe('acme');
    expect(boardOf('https://careers.acme.com.au/1')).toBe('acme');
    expect(boardOf('https://acme.co.nz/1')).toBe('acme');
    expect(boardOf('https://acme.org.uk/1')).toBe('acme');
    // a plain .co, or the ending alone, stays as before
    expect(boardOf('https://jobs.lever.co/acme/1')).toBe('lever');
    expect(boardOf('https://co.uk/')).toBe('co');
  });

  it('a known board under a two-part ending is still that board', () => {
    expect(boardOf('https://www.indeed.co.uk/viewjob?jk=abc')).toBe('indeed');
    expect(cleanLink('https://www.indeed.co.uk/viewjob?jk=abc&from=serp&utm_source=x')).toBe(
      'https://www.indeed.co.uk/viewjob?jk=abc',
    );
  });

  it('unknown for what is not a link or not a valid board id', () => {
    expect(boardOf('not a link')).toBe('unknown');
    expect(boardOf('ftp://files.acme.com/x')).toBe('unknown');
    expect(boardOf('https://xn--80ak6aa92e.com/')).toBe('xn--80ak6aa92e');
    expect(boardOf(`https://${'a'.repeat(31)}.com/`)).toBe('unknown');
  });

  it('every suggestion is a valid board id', () => {
    for (const b of BOARD_SUGGESTIONS) expect(BOARD_RE.test(b), b).toBe(true);
  });
});

describe('cleanLink', () => {
  it("a board's own link loses its whole query and hash", () => {
    expect(cleanLink('https://justjoin.it/job-offer/acme-react?utm_source=x&from=list#apply')).toBe(
      'https://justjoin.it/job-offer/acme-react',
    );
    expect(cleanLink('https://bulldogjob.pl/companies/jobs/123-react?x=1')).toBe(
      'https://bulldogjob.pl/companies/jobs/123-react',
    );
  });

  it('NoFluff links are kept as /pl/job/', () => {
    expect(cleanLink('https://nofluffjobs.com/job/react-acme?utm_source=x')).toBe(
      'https://nofluffjobs.com/pl/job/react-acme',
    );
    expect(cleanLink('https://nofluffjobs.com/en/job/react-acme')).toBe('https://nofluffjobs.com/pl/job/react-acme');
    expect(cleanLink('https://nofluffjobs.com/pl/job/react-acme')).toBe('https://nofluffjobs.com/pl/job/react-acme');
    expect(cleanLink('https://nofluffjobs.com/pl/praca-it/react')).toBe('https://nofluffjobs.com/pl/praca-it/react');
  });

  it('LinkedIn: the canonical job link when the id is there', () => {
    const canonical = 'https://www.linkedin.com/jobs/view/4123456789';
    expect(
      cleanLink('https://pl.linkedin.com/jobs/view/senior-react-dev-at-acme-4123456789?trk=public_jobs&refId=abc'),
    ).toBe(canonical);
    expect(cleanLink('https://www.linkedin.com/jobs/view/4123456789/?trackingId=x')).toBe(canonical);
    expect(cleanLink('https://www.linkedin.com/jobs/search/?currentJobId=4123456789&keywords=react')).toBe(canonical);
    // no id: only the tracking goes
    expect(cleanLink('https://www.linkedin.com/company/acme/?trk=abc&position=1&pageNum=0&lang=pl')).toBe(
      'https://www.linkedin.com/company/acme/?lang=pl',
    );
  });

  it('other sites keep their query but lose tracking parameters', () => {
    expect(
      cleanLink('https://boards.greenhouse.io/acme/jobs/1?gh_jid=1&utm_source=li&UTM_Medium=x&ref=abc&source=x#apply'),
    ).toBe('https://boards.greenhouse.io/acme/jobs/1?gh_jid=1');
    // only exact names (or the utm_ / trk prefixes) are tracking: "reference" and "sources" stay
    expect(cleanLink('https://acme.test/job?reference=7&sources=a&trkCampaign=x')).toBe(
      'https://acme.test/job?reference=7&sources=a',
    );
  });

  it('Indeed: the job link with only its id (?jk=…)', () => {
    const canonical = 'https://pl.indeed.com/viewjob?jk=0123456789abcdef';
    expect(cleanLink('https://pl.indeed.com/viewjob?jk=0123456789abcdef&from=serp&tk=1abc#apply')).toBe(canonical);
    expect(cleanLink('https://pl.indeed.com/rc/clk?jk=0123456789abcdef&bb=xyz&xkcb=SoA')).toBe(canonical);
    // a search page showing one job
    expect(cleanLink('https://pl.indeed.com/jobs?q=react&l=Warszawa&vjk=0123456789abcdef')).toBe(canonical);
    // no id: only the tracking goes
    expect(cleanLink('https://pl.indeed.com/jobs?q=react&utm_source=x')).toBe('https://pl.indeed.com/jobs?q=react');
  });

  it('not a link: just trimmed', () => {
    expect(cleanLink('  not a link ')).toBe('not a link');
    expect(cleanLink('  https://acme.test/a  ')).toBe('https://acme.test/a');
  });
});

describe('boardIdOf', () => {
  it("the id the scrapers store, from each board's link", () => {
    expect(boardIdOf('justjoin', 'https://justjoin.it/job-offer/acme-react-dev-warszawa?x=1')).toBe(
      'acme-react-dev-warszawa',
    );
    expect(boardIdOf('nofluff', 'https://nofluffjobs.com/pl/job/react-dev-acme-warszawa')).toBe(
      'react-dev-acme-warszawa',
    );
    expect(boardIdOf('bulldog', 'https://bulldogjob.pl/companies/jobs/257103-web-architect')).toBe(
      '257103-web-architect',
    );
    expect(boardIdOf('eldorado', 'https://czyjesteldorado.pl/praca/449389-scrum-master')).toBe('449389');
    expect(
      boardIdOf('himalayas', 'https://himalayas.app/companies/lemon-io/jobs/senior-full-stack-developer-4016266853'),
    ).toBe('lemon-io/senior-full-stack-developer-4016266853');
    expect(boardIdOf('linkedin', 'https://www.linkedin.com/jobs/view/4123456789/')).toBe('4123456789');
    expect(boardIdOf('linkedin', 'https://pl.linkedin.com/jobs/view/senior-dev-at-acme-4123456789')).toBe('4123456789');
    expect(
      boardIdOf('linkedin', 'https://www.linkedin.com/jobs/collections/recommended/?currentJobId=4123456789'),
    ).toBe('4123456789');
    expect(boardIdOf('indeed', 'https://pl.indeed.com/viewjob?jk=0123456789abcdef&from=serp')).toBe('0123456789abcdef');
    expect(boardIdOf('indeed', 'https://pl.indeed.com/jobs?q=react&vjk=0123456789abcdef')).toBe('0123456789abcdef');
  });

  it('decodes the path', () => {
    expect(boardIdOf('justjoin', 'https://justjoin.it/job-offer/acme-krak%C3%B3w')).toBe('acme-kraków');
  });

  it('null when the link has no id, for other boards, and for what is not a link', () => {
    expect(boardIdOf('justjoin', 'https://justjoin.it/job-offers/all-locations/javascript')).toBeNull();
    expect(boardIdOf('linkedin', 'https://www.linkedin.com/jobs/view/12345')).toBeNull(); // ids have 6+ digits
    expect(boardIdOf('linkedin', 'https://www.linkedin.com/feed/')).toBeNull();
    expect(boardIdOf('eldorado', 'https://czyjesteldorado.pl/praca/scrum-master')).toBeNull();
    expect(boardIdOf('pracuj', 'https://www.pracuj.pl/praca/react,oferta,1004')).toBeNull();
    expect(boardIdOf('indeed', 'https://pl.indeed.com/jobs?q=react&jk=')).toBeNull();
    expect(boardIdOf('justjoin', 'not a link')).toBeNull();
  });

  it('a stray "%" in the path stays as it is instead of throwing', () => {
    expect(boardIdOf('justjoin', 'https://justjoin.it/job-offer/50%-remote')).toBe('50%-remote');
    expect(boardIdOf('justjoin', 'https://justjoin.it/job-offer/krak%C3%B3w-50%-remote')).toBe('kraków-50%-remote');
    // a broken UTF-8 sequence too
    expect(boardIdOf('justjoin', 'https://justjoin.it/job-offer/a%C3-b')).toBe('a%C3-b');
    expect(boardIdOf('eldorado', 'https://czyjesteldorado.pl/praca/449389-100%-zdalnie')).toBe('449389');
    expect(() => cleanLink('https://www.linkedin.com/jobs/view/50%-off-4123456789')).not.toThrow();
  });
});
