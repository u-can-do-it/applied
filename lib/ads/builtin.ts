import 'server-only';
import { htmlToText } from '../shared/html';
import type { AdReader } from './details';
import { readPage } from './page';

// Built In: no JobPosting, so the ad body is cut out of the HTML.

function adBody(html: string) {
  const i = html.search(/id="job-post-body-\d+"/);
  if (i < 0) return '';
  const start = html.indexOf('>', i) + 1;
  // the body is one block; the next section starts with another id="job-..." or a <section>
  const rest = html.slice(start);
  const end = rest.search(/<section|id="job-(?!post-body)/);
  return htmlToText(end > 0 ? rest.slice(0, end) : rest.slice(0, 60_000));
}

export const readBuiltin: AdReader = (offer) => readPage(offer.url, adBody);
