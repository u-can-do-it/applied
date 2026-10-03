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
  const p = (await (
    await get(`https://nofluffjobs.com/api/posting/${encodeURIComponent(id)}`)
  ).json()) as NofluffPosting;
  const list = (xs: { value?: string }[] | undefined) =>
    (xs ?? [])
      .map((x) => x.value)
      .filter(Boolean)
      .join(', ');
  const tasks = (p.specs?.dailyTasks ?? []).map((t) => `• ${asString(t).trim()}`).join('\n');
  const text = [
    list(p.requirements?.musts) && `Must have: ${list(p.requirements?.musts)}`,
    list(p.requirements?.nices) && `Nice to have: ${list(p.requirements?.nices)}`,
    p.basics?.seniority?.length && `Seniority: ${p.basics.seniority.join(', ')}`,
    p.requirements?.languages?.length && `Languages: ${languages(p.requirements.languages)}`,
    htmlToText(p.requirements?.description),
    tasks && `Daily tasks:\n${tasks}`,
    htmlToText(p.details?.description),
  ]
    .filter(Boolean)
    .join('\n\n');

  const sal = p.essentials?.originalSalary;
  const types = Object.entries(sal?.types ?? {});
  const cities = (p.location?.places ?? []).map((pl) => pl.city);
  const details: JobDetails = {
    salary:
      types
        .map(([k, t]) =>
          `${(t.range ?? []).map(money).join('–')} ${sal?.currency ?? ''} / ${unit(t.period)} (${CONTRACTS[k] ?? k})`.replace(
            /\s+/g,
            ' ',
          ),
        )
        .join('; ') || undefined,
    contract: unique(types.map(([k]) => CONTRACTS[k] ?? k)).join(', ') || undefined,
    location: unique(cities.filter((c) => c && c !== 'Remote')).join(', ') || undefined,
    remote: cities.includes('Remote') || undefined,
    posted: day(p.posted),
    validUntil: day(p.expiresAt),
    company: p.company?.name || undefined,
  };
  return { text, details };
};
