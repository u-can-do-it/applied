import 'server-only';
import { parse as parseHtml } from 'node-html-parser';
import { htmlToText } from '../shared/html';
import type { AdReader, JobDetails } from './details';
import { get } from './fetch';
import { readPage } from './page';

// LinkedIn: its public (logged-out) job posting fragment.

// criteria come in the page's language (Accept-Language: pl first)
const LI_CONTRACT = ['Employment type', 'Forma zatrudnienia', 'Rodzaj zatrudnienia'];

async function fromFragment(id: string) {
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
  const details: JobDetails = {
    company: one('.topcard__org-name-link'),
    location: one('.topcard__flavor--bullet'),
    salary: one('.compensation__salary'),
    contract: criteria.find(([k]) => LI_CONTRACT.includes(k))?.[1],
  };
  const lines = criteria.filter(([k, v]) => k && v).map(([k, v]) => `${k}: ${v}`);
  return { text: [lines.join('\n'), description].filter(Boolean).join('\n\n'), details };
}

export const readLinkedin: AdReader = async (copy) => {
  try {
    return await fromFragment(copy.id);
  } catch {
    return readPage(copy.url); // the job page has a JobPosting too, when LinkedIn shows it
  }
};
