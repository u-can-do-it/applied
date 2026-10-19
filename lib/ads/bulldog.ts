import 'server-only';
import { parsePage, scriptById } from '../dom';
import { arr, isObj, str, type Obj } from '../listings/extract';
import { htmlToText } from '../shared/html';
import { day, money, unique, unit, type AdReader, type JobDetails, type WorkMode } from './details';
import { get } from './fetch';
import { findJobPosting, fromJobPosting } from './job-posting';

// Bulldog: the page's JobPosting, as for any board; but some of its pages come without one (seen 2026-10-19,
// next to others with it), so the ad is read from the page's __NEXT_DATA__ then, where the page has it all.

const CONTRACTS = [
  ['contractEmployment', 'Employment contract (UoP)'],
  ['contractB2b', 'B2B'],
  ['contractOther', 'Other'],
] as const;
const SALARIES = [
  ['employmentSalary', 'UoP'],
  ['b2bSalary', 'B2B'],
  ['otherSalary', 'other'],
] as const;

/** The most flexible mode it offers: remote if it may be done remotely, else hybrid, else on site. */
function workModeOf(modes: string[]): WorkMode | undefined {
  if (modes.includes('full-remote')) return 'remote';
  if (modes.includes('hybrid')) return 'hybrid';
  return modes.includes('on-site') ? 'onsite' : undefined;
}

/** "From 72 800 EUR / year (UoP)": Bulldog's own words for the amount, else its range. */
function salaryOf(salary: unknown, contract: string) {
  if (!isObj(salary) || salary.hidden === true) return undefined;
  const range =
    str(salary.money) ||
    [salary.minValue, salary.maxValue]
      .filter((amount) => amount != null)
      .map(money)
      .join('–');
  if (!range) return undefined;
  const per = str(salary.timeframe) ? ` / ${unit(salary.timeframe)}` : '';
  return `${range} ${str(salary.currency)}${per} (${contract})`.replace(/\s+/g, ' ');
}

/** The ad from the page's data: its stack, the requirements, the role, what it offers; and the details. */
function fromJob(job: Obj): { text: string; details: JobDetails } {
  const skills = arr(job.technologyTags).map(str).filter(Boolean);
  const years = typeof job.minExperienceInYears === 'number' ? job.minExperienceInYears : null;
  const text = [
    skills.length > 0 && `Skills: ${skills.join(', ')}`,
    years !== null && `Experience: ${years}+ years`,
    htmlToText(job.requirements),
    htmlToText(job.details),
    htmlToText(job.offer),
  ]
    .filter(Boolean)
    .join('\n\n');
  const cities = arr(job.locations).map((place) => {
    const location = isObj(place) && isObj(place.location) ? place.location : {};
    return str(location.cityEn) || str(location.cityPl);
  });
  const workMode = workModeOf(arr(job.workModes).map(str));
  return {
    text,
    details: {
      salary: unique(SALARIES.map(([field, contract]) => salaryOf(job[field], contract))).join('; ') || undefined,
      contract:
        unique(CONTRACTS.map(([field, name]) => (job[field] === true ? name : undefined))).join(', ') || undefined,
      location: unique(cities).join(', ') || undefined,
      remote: workMode === 'remote' || undefined,
      workMode,
      posted: day(job.publishedAt),
      validUntil: day(job.endsAt),
      company: (isObj(job.company) && str(job.company.name)) || undefined,
    },
  };
}

export const readBulldog: AdReader = async ({ url }) => {
  const page = parsePage(await (await get(url, 'text/html')).text());
  const jp = findJobPosting(page);
  if (jp) return fromJobPosting(jp);
  let data: unknown = null;
  try {
    data = JSON.parse(scriptById(page, '__NEXT_DATA__') ?? 'null');
  } catch {
    // not JSON: no ad in it
  }
  const pageProps = isObj(data) && isObj(data.props) && isObj(data.props.pageProps) ? data.props.pageProps : {};
  const job = isObj(pageProps.data) && isObj(pageProps.data.job) ? pageProps.data.job : null;
  return job ? fromJob(job) : { text: '', details: {} };
};
