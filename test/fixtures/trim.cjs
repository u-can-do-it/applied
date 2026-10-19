// Trims raw board responses (recorded as described in README.md here) to a few offers each and
// writes them next to this file. Usage: node test/fixtures/trim.cjs <directory with the raw responses>
const fs = require('fs');
const path = require('path');
const { parse } = require('node-html-parser');

const RAW = process.argv[2];
if (!RAW) {
  console.error('Usage: node test/fixtures/trim.cjs <directory with the raw responses>');
  process.exit(1);
}
const OUT = __dirname;
const N = 3;
const raw = (f) => fs.readFileSync(path.join(RAW, f), 'utf8');
const write = (f, s) => { fs.writeFileSync(path.join(OUT, f), s); console.log(f, s.length); };
const scriptRe = (id) => new RegExp(`(<script[^>]*\\bid="${id}"[^>]*>)([\\s\\S]*?)</script>`);

// JustJoin: JSON API
{ const j = JSON.parse(raw('justjoin.json')); j.data = j.data.slice(0, N); write('justjoin.json', JSON.stringify(j, null, 2) + '\n'); }
// Solid.jobs: JSON API
{ const j = JSON.parse(raw('solidjobs.json')); j.jobs = j.jobs.slice(0, N); write('solidjobs.json', JSON.stringify(j, null, 2) + '\n'); }
// NoFluff: the serverApp-state script; keep the small keys around the postings one (order matters to the parser)
{
  const m = raw('nofluff.html').match(scriptRe('serverApp-state'));
  const state = JSON.parse(m[2]);
  const keep = {};
  for (const [k, v] of Object.entries(state)) {
    const o = v && v.body ? v.body : v;
    if (o && Array.isArray(o.postings)) {
      keep[k] = { ...v, postings: o.postings.slice(0, N), divs: undefined, additionalSearchDivs: undefined };
    } else if (JSON.stringify(v).length < 5000) keep[k] = v;
  }
  write('nofluff.html', `<!DOCTYPE html><html lang="pl"><head><title>React – praca IT</title></head><body><nfj-root></nfj-root>\n${m[1]}${JSON.stringify(keep)}</script></body></html>\n`);
}
// Bulldog: __NEXT_DATA__
{
  const m = raw('bulldog.html').match(scriptRe('__NEXT_DATA__'));
  const d = JSON.parse(m[2]);
  const pp = d.props.pageProps;
  d.props = { pageProps: { country: pp.country, totalCount: pp.totalCount, jobs: pp.jobs.slice(0, N) }, __N_SSP: d.props.__N_SSP };
  write('bulldog.html', `<!DOCTYPE html><html lang="pl"><head><title>Bulldogjob</title></head><body><div id="__next"></div>\n${m[1]}${JSON.stringify(d)}</script></body></html>\n`);
}
// Built In: the job cards (the last one cut where the next section starts)
{
  const h = raw('builtin.html');
  const parts = h.split(/<div id="job-card-(?=\d)/);
  const cards = parts.slice(1, 1 + N);
  const last = cards[cards.length - 1];
  const stop = last.indexOf('<div id="product-cta"');
  if (stop > 0) cards[cards.length - 1] = last.slice(0, stop);
  write('builtin.html', `<!DOCTYPE html><html lang="en"><head><title>Remote React Jobs in Poland | Built In</title></head><body><div id="search-results">\n${cards.map((c) => `<div id="job-card-${c}`).join('')}\n</div></body></html>\n`);
}
// LinkedIn: the guest search fragment, a list of <li> cards
{
  const root = parse(raw('linkedin.html'));
  const lis = root.childNodes.filter((n) => n.rawTagName === 'li').slice(0, N);
  // the per-request tracking values (attributes and link parameters) become placeholders
  const html = lis
    .map((l) => l.outerHTML)
    .join('\n')
    .replace(/(data-reference-id|data-tracking-id)="[^"]*"/g, '$1="REDACTED"')
    .replace(/([?&](?:amp;)?(?:refId|trackingId)=)[^&"]*/g, '$1REDACTED');
  write('linkedin.html', '<!DOCTYPE html>\n' + html + '\n');
}
