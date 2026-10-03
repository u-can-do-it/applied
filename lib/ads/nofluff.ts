import 'server-only';
import { htmlToText } from '../shared/html';
import {
  CONTRACTS,
  day,
  languages,
  money,
  asString,
  unique,
  unit,
  type AdReader,
  type JobDetails,
  type Language,
} from './details';
import { get } from './fetch';

// NoFluff: its public posting API (formatted body, skills, salary). Its JobPosting only has the
// benefits, so there is no fallback to the page.

// the parts of the posting API that are read below; all of it may be missing
type NofluffPosting = {
  specs?: { dailyTasks?: unknown[] };
  requirements?: {
    musts?: { value?: string }[];
    nices?: { value?: string }[];
    languages?: Language[];
    description?: string;
  };
  basics?: { seniority?: string[] };
  details?: { description?: string };
  essentials?: {
    originalSalary?: { currency?: string; types?: Record<string, { period?: string; range?: number[] }> };
  };
  location?: { places?: { city?: string }[] };
  posted?: number;
  expiresAt?: number;
  company?: { name?: string };
};

export const readNofluff: AdReader = async ({ id }) => {
  const posting = (await (
    await get(`https://nofluffjobs.com/api/posting/${encodeURIComponent(id)}`)
  ).json()) as NofluffPosting;
  const list = (xs: { value?: string }[] | undefined) =>
    (xs ?? [])
      .map((item) => item.value)
      .filter(Boolean)
      .join(', ');
  const tasks = (posting.specs?.dailyTasks ?? []).map((task) => `• ${asString(task).trim()}`).join('\n');
  const text = [
    list(posting.requirements?.musts) && `Must have: ${list(posting.requirements?.musts)}`,
    list(posting.requirements?.nices) && `Nice to have: ${list(posting.requirements?.nices)}`,
    posting.basics?.seniority?.length && `Seniority: ${posting.basics.seniority.join(', ')}`,
    posting.requirements?.languages?.length && `Languages: ${languages(posting.requirements.languages)}`,
    htmlToText(posting.requirements?.description),
    tasks && `Daily tasks:\n${tasks}`,
    htmlToText(posting.details?.description),
  ]
    .filter(Boolean)
    .join('\n\n');

  const original = posting.essentials?.originalSalary;
  const types = Object.entries(original?.types ?? {});
  const cities = (posting.location?.places ?? []).map((place) => place.city);
  const details: JobDetails = {
    salary:
      types
        .map(([contract, salary]) =>
          `${(salary.range ?? []).map(money).join('–')} ${original?.currency ?? ''} / ${unit(salary.period)} (${CONTRACTS[contract] ?? contract})`.replace(
            /\s+/g,
            ' ',
          ),
        )
        .join('; ') || undefined,
    contract: unique(types.map(([contract]) => CONTRACTS[contract] ?? contract)).join(', ') || undefined,
    location: unique(cities.filter((city) => city && city !== 'Remote')).join(', ') || undefined,
    remote: cities.includes('Remote') || undefined,
    posted: day(posting.posted),
    validUntil: day(posting.expiresAt),
    company: posting.company?.name || undefined,
  };
  return { text, details };
};
