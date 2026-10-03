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
// Eldorado: Next.js app router flight chunks; the jobs array cut to N, the text split over two chunks
{
  const h = raw('eldorado.html');
  let text = '';
  for (const m of h.matchAll(/self\.__next_f\.push\(\[1,("(?:\\.|[^"\\])*")\]\)/g)) text += JSON.parse(m[1]);
  const key = '"jobs":[';
  const i = text.indexOf(key);
  // the array: same bracket counting as the parser
  let depth = 0, inStr = false, esc = false, end = -1;
  for (let k = i + key.length - 1; k < text.length; k++) {
    const c = text[k];
    if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true; else if (c === '[') depth++; else if (c === ']' && --depth === 0) { end = k + 1; break; }
  }
  const jobs = JSON.parse(text.slice(i + key.length - 1, end)).slice(0, N);
  const lineStart = text.lastIndexOf('\n', i) + 1;
  const lineEnd = text.indexOf('\n', end);
  const line = text.slice(lineStart, i) + key.slice(0, -1) + JSON.stringify(jobs) + text.slice(end, lineEnd + 1);
  const cut = Math.floor(line.length / 2);
  const chunk = (s) => `<script>self.__next_f.push([1,${JSON.stringify(s).replace(/</g, '\\u003c')}])</script>`;
  write('eldorado.html', `<!DOCTYPE html><html lang="pl"><head><title>Eldorado</title></head><body>\n<script>(self.__next_f=self.__next_f||[]).push([0])</script>\n${chunk('1:"$Sreact.fragment"\n')}\n${chunk(line.slice(0, cut))}\n${chunk(line.slice(cut))}\n</body></html>\n`);
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
