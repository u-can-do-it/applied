import 'server-only';
import { htmlToText } from '../shared/html';
import { asString, day, money, type AdReader, type JobDetails } from './details';
import { get } from './fetch';

// Himalayas: its job pages turn servers away (403), so the ad comes from its search API: the company's jobs,
// the one with this offer's link. (There is no API for one job.)

type HimalayasJob = {
  guid?: string;
  applicationLink?: string;
  description?: string;
  companyName?: string;
  employmentType?: string;
  minSalary?: number | null;
  maxSalary?: number | null;
  salaryPeriod?: string;
  currency?: string;
  locationRestrictions?: string[];
  pubDate?: number; // seconds
  expiryDate?: number;
};

const PERIODS: Partial<Record<string, string>> = {
  hourly: 'hour',
  weekly: 'week',
  fortnightly: 'fortnight',
  monthly: 'month',
  annual: 'year',
};

function salaryOf(job: HimalayasJob) {
  const amounts = [...new Set([job.minSalary, job.maxSalary].filter((amount) => typeof amount === 'number'))];
  if (!amounts.length) return undefined;
  return `${amounts.map(money).join('–')} ${job.currency ?? ''} / ${PERIODS[job.salaryPeriod ?? 'annual'] ?? job.salaryPeriod}`.replace(
    /\s+/g,
    ' ',
  );
}

/** Where you may work from: "Anywhere", "Poland", "Poland, Germany, Spain +40 more" (Poland first). */
function placesOf(countries: string[]) {
  if (!countries.length) return 'Anywhere';
  const ordered = [...countries].sort((a, b) => Number(b === 'Poland') - Number(a === 'Poland'));
  return ordered.length > 3 ? `${ordered.slice(0, 3).join(', ')} +${ordered.length - 3} more` : ordered.join(', ');
}

export const readHimalayas: AdReader = async (offer) => {
  const company = offer.id.split('/')[0];
  const answer = (await (
    await get(
      `https://himalayas.app/jobs/api/search?company=${encodeURIComponent(company)}&sort=recent`,
      'application/json',
    )
  ).json()) as { jobs?: HimalayasJob[] };
  const job = answer.jobs?.find((one) => one.applicationLink === offer.url || one.guid === offer.url);
  if (!job) return { text: '', details: {} }; // gone, or past the company's first page
  const details: JobDetails = {
    company: job.companyName || undefined,
    salary: salaryOf(job),
    contract: job.employmentType || undefined,
    location: placesOf(job.locationRestrictions ?? []),
    workMode: 'remote',
    remote: true,
    posted: job.pubDate ? day(job.pubDate * 1000) : undefined,
    validUntil: job.expiryDate ? day(job.expiryDate * 1000) : undefined,
  };
  return { text: htmlToText(asString(job.description)), details };
};
