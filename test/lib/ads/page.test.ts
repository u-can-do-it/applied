import { afterEach, describe, expect, it, vi } from 'vitest';
import { readJobPage, scrapeOffer } from '@/lib/ads';
import { findJobPosting } from '@/lib/ads/job-posting';
import { mainText, pageTitle, parsePage, scriptById, scriptsOfType } from '@/lib/dom';

// Reading an ad's page with the HTML parser: the JobPosting, a page's <main>, Built In's ad body,
// the <title>. Requests are answered here (`fetch` stubbed), without LinkedIn's pace (test/lib/pace.test.ts).

vi.mock('@/lib/pace', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/pace')>()),
  paced: (_url: string, request: () => Promise<Response>) => request(),
}));

const answer = (html: string) =>
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve(new Response(html))),
  );
afterEach(() => {
  vi.unstubAllGlobals();
});

const LONG = 'React, TypeScript and a lot of other things this ad says about the job, long enough.';

describe('the page', () => {
  it('finds the JobPosting: any quoting, any attribute order, in an @graph or a list', () => {
    const page = parsePage(`<head>
      <script type="application/ld+json">{"@type": "Organization", "name": "Acme"}</script>
      <script data-x='1' type='application/ld+json'>not JSON</script>
      <script TYPE="Application/LD+JSON">{"@graph": [{"@type": "WebPage"}, [{"@type": ["JobPosting"], "title": "Dev"}]]}</script>
    </head>`);
    expect(findJobPosting(page)).toEqual({ '@type': ['JobPosting'], title: 'Dev' });
    expect(findJobPosting(parsePage('<script type="application/json">{"@type":"JobPosting"}</script>'))).toBeNull();
  });

  it("keeps a script's text as it is, tags and entities included", () => {
    const page = parsePage(
      '<script id="state" type="application/json">{"a": "</div><p>&amp;"}</script><script id="other">x</script>',
    );
    expect(scriptById(page, 'state')).toBe('{"a": "</div><p>&amp;"}');
    expect(scriptById(page, 'missing')).toBeNull();
    expect(scriptsOfType(page, 'application/json')).toEqual(['{"a": "</div><p>&amp;"}']);
  });

  it("reads the <main>, else the <article>, as text; a tag left open doesn't lose it", () => {
    expect(mainText('<nav>Menu</nav><main class="x"><h1>Dev</h1><p>We need <b>you</b>.</p></main>')).toBe(
      'Dev\n\nWe need you .',
    );
    expect(mainText('<body><article><p>Only an article</p></article></body>')).toBe('Only an article');
    expect(mainText('<body><main><p>Hi<li>React</main></body>')).toBe('Hi\n• React');
    expect(mainText('<body><div>No main</div></body>')).toBe('');
    // a <div> left open inside <main>: the footer after </main> stays out, as it did with the old reader
    expect(mainText('<body><main><div><p>Hi</main><footer>Footer links</footer></body>')).toBe('Hi');
    expect(mainText('<main data-x="a>b"><p>Quoted</p></main>')).toBe('Quoted');
  });

  it("the <title> in the head, not an icon's", () => {
    expect(pageTitle(parsePage('<html><head><title> Dev &amp;\n Ops </title></head></html>'))).toBe('Dev & Ops');
    expect(pageTitle(parsePage('<body><svg><title>icon</title></svg></body>'))).toBe('icon');
    expect(pageTitle(parsePage('<p>none</p>'))).toBe('');
  });
});

describe('ad readers', () => {
  it("Built In: the ad body's element, without what follows it", async () => {
    answer(`<html><body><div id="job-post-body-123" class="x"><p>${LONG}</p><ul><li>Remote</li></ul></div>
      <section id="job-benefits">Benefits</section><div id="job-similar">Other jobs</div></body></html>`);
    const ad = await scrapeOffer({ src: 'builtin', id: '1', url: 'https://builtin.com/job/x/1' });
    expect(ad).toEqual({ status: 'ok', text: `${LONG}\n• Remote`, details: {} });
  });

  describe('LinkedIn', () => {
    const offer = { src: 'linkedin', id: '1', url: 'https://www.linkedin.com/jobs/view/1' };
    const criteria = `<ul><li class="description__job-criteria-item">
        <h3 class="description__job-criteria-subheader">Forma zatrudnienia</h3>
        <span class="description__job-criteria-text">Pełny etat</span></li>
      <li class="description__job-criteria-item">
        <h3 class="description__job-criteria-subheader">Branże</h3>
        <span class="description__job-criteria-text">Tworzenie oprogramowania i wiele innych branż</span></li></ul>`;
    const pages = (fragment: Response, jobPage: string) =>
      vi.stubGlobal(
        'fetch',
        vi.fn((url: string) => Promise.resolve(url.includes('/jobs-guest/') ? fragment : new Response(jobPage))),
      );

    it('the posting fragment: its criteria, then the ad', async () => {
      answer(`${criteria}<div class="show-more-less-html__markup"><p>${LONG}</p></div>`);
      const ad = await scrapeOffer(offer);
      expect(ad.status).toBe('ok');
      expect(ad.text).toBe(
        `Forma zatrudnienia: Pełny etat\nBranże: Tworzenie oprogramowania i wiele innych branż\n\n${LONG}`,
      );
    });

    it('turned away (HTTP 429, a login wall): an error to retry, never "no ad text" to keep', async () => {
      pages(new Response('', { status: 429 }), '<html><body><main>Sign in to see this job</main></body></html>');
      await expect(scrapeOffer(offer)).rejects.toThrow('LinkedIn showed no ad');
      // the fragment's criteria alone pass for an ad's length, but aren't one
      pages(new Response(criteria), '<html><body>Sign in</body></html>');
      await expect(scrapeOffer(offer)).rejects.toThrow('LinkedIn showed no ad');
    });

    it("the job page's JobPosting when the fragment fails", async () => {
      pages(
        new Response('', { status: 429 }),
        `<script type="application/ld+json">{"@type": "JobPosting", "description": "<p>${LONG}</p>"}</script>`,
      );
      expect(await scrapeOffer(offer)).toMatchObject({ status: 'ok', text: LONG });
    });
  });

  it("a JobPosting's salary: in its QuantitativeValue, on the MonetaryAmount itself, or one number", async () => {
    const salaryOf = async (baseSalary: object) => {
      answer(
        `<script type="application/ld+json">${JSON.stringify({ '@type': 'JobPosting', description: LONG, baseSalary })}</script>`,
      );
      return (await scrapeOffer({ src: 'solidjobs', id: '1', url: 'https://solid.jobs/offer/1' })).details.salary;
    };
    expect(await salaryOf({ currency: 'PLN', value: { minValue: 20000, maxValue: 25000, unitText: 'MONTH' } })).toBe(
      '20 000–25 000 PLN / month',
    );
    expect(await salaryOf({ currency: 'PLN', minValue: 10000, maxValue: 17000 })).toBe('10 000–17 000 PLN');
    expect(await salaryOf({ currency: 'EUR', value: 90000, unitText: 'YEAR' })).toBe('90 000 EUR / year');
    expect(await salaryOf({ currency: 'PLN', value: { minValue: 150, maxValue: 150, unitText: 'HOUR' } })).toBe(
      '150 PLN / hour',
    );
  });

  it("an unknown site: the JobPosting, else the <main>, and the page's title", async () => {
    answer(`<html><head><title>Dev at Acme</title></head><body><main><p>${LONG}</p></main></body></html>`);
    expect(await readJobPage({ src: '', id: '', url: 'https://acme.test/job' })).toEqual({
      pageTitle: 'Dev at Acme',
      text: LONG,
      details: {},
    });
    answer(`<html><head><title>T</title></head><body><nav>Menu</nav><div>${LONG}</div></body></html>`);
    expect((await readJobPage({ src: '', id: '', url: 'https://acme.test/job' })).text).toBe(`Menu ${LONG}`);
  });
});
