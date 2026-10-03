import 'server-only';
import type { Page } from '../dom';
import { htmlToText } from '../shared/html';
import type { AdReader } from './details';
import { readPage } from './page';

// Built In: no JobPosting, so the ad body is read from its element (id="job-post-body-<n>").

function adBody(page: Page) {
  const body = page
    .querySelectorAll('[id^="job-post-body-"]')
    .find((element) => /^job-post-body-\d+$/.test(element.id));
  return body ? htmlToText(body.innerHTML) : '';
}

export const readBuiltin: AdReader = (offer) => readPage(offer.url, adBody);
