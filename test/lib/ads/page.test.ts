import { afterEach, describe, expect, it, vi } from 'vitest';
import { readJobPage, scrapeOffer } from '@/lib/ads';
import { findJobPosting } from '@/lib/ads/job-posting';
import { mainText, pageTitle, parsePage, scriptById, scriptsOfType } from '@/lib/dom';

// Reading an ad's page with the HTML parser: the JobPosting, a page's <main>, Built In's ad body,
// the <title>. Requests are answered here (`fetch` stubbed).

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
      'Dev\nWe need you .',
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
