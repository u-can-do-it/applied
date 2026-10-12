import 'server-only';
import { parse as parseHtml } from 'node-html-parser';
import { htmlToText } from '../shared/html';
import { isAdText, type Ad, type AdReader, type JobDetails } from './details';
import { get } from './fetch';
import { readPage } from './page';

// LinkedIn: its public (logged-out) job posting fragment. Every posting has an ad, so one read without it
// is LinkedIn turning the server away (HTTP 429 to a burst of reads, a login wall after some twenty): an
// error, not "this job has no ad text" to keep, so the next read tries again.

// criteria come in the page's language (Accept-Language: pl first)
const LI_CONTRACT = ['Employment type', 'Forma zatrudnienia', 'Rodzaj zatrudnienia'];

/** One posting as its public fragment has it: the ad, and its title (a job from an alert email has no card). */
export async function readPosting(id: string): Promise<Ad & { title: string }> {
  const html = await (
    await get(`https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/${encodeURIComponent(id)}`, 'text/html')
  ).text();
  const root = parseHtml(html);
  const one = (sel: string) => root.querySelector(sel)?.text.replace(/\s+/g, ' ').trim() || undefined;
  const criteria = root
    .querySelectorAll('.description__job-criteria-item')
    .map((li) => [
      li.querySelector('.description__job-criteria-subheader')?.text.trim() ?? '',
      li.querySelector('.description__job-criteria-text')?.text.replace(/\s+/g, ' ').trim() ?? '',
    ]);
  const description = htmlToText(root.querySelector('.show-more-less-html__markup')?.innerHTML ?? '');
  // its criteria alone (three lines) pass for an ad's length
  if (!description.trim()) throw new Error('LinkedIn showed no ad (a login wall?)');
  const details: JobDetails = {
    company: one('.topcard__org-name-link'),
    location: one('.topcard__flavor--bullet'),
    salary: one('.compensation__salary'),
    contract: criteria.find(([label]) => LI_CONTRACT.includes(label))?.[1],
  };
  const lines = criteria.filter(([label, value]) => label && value).map(([label, value]) => `${label}: ${value}`);
  return {
    title: one('.top-card-layout__title') ?? '',
    text: [lines.join('\n'), description].filter(Boolean).join('\n\n'),
    details,
  };
}

export const readLinkedin: AdReader = async (offer) => {
  try {
    const { text, details } = await readPosting(offer.id);
    return { text, details };
  } catch {
    // the job page has a JobPosting too, when LinkedIn shows it
    const page = await readPage(offer.url);
    if (!isAdText(page.text)) throw new Error('LinkedIn showed no ad (a login wall?)');
    return page;
  }
};
