// The `ats` kind: a company's open jobs from its ATS's public API (lib/listings/ats.ts has the ATSs and
// their links). No skills: the keyword check reads the title alone, as a job's department ("Engineering")
// or description lets almost anything through. No sort value either: there are no bumped-up offers to skip,
// and Lever's createdAt and Workable's day-only dates would hide new ones behind the watermark.
import { atsOf, type AtsId } from '../ats';
import { arr, isObj, json, keysOf, nameOf, sampleOf, seniorityOf, str, type Obj } from '../extract';
import { fold } from '../match';
import type { ListingParser } from '../types';

type Job = {
  id: string;
  title: string;
  url: string;
  /** when the ATS gives it */
  company?: string;
  /** where it is: cities, countries, "Remote, France" */
  places: string[];
  remote: boolean;
};

type Reader = {
  jobs: (data: unknown) => unknown[] | null;
  read: (job: Obj, data: unknown) => Job;
};

const listAt = (data: unknown, key: string) => (isObj(data) && Array.isArray(data[key]) ? data[key] : null);

const READERS: Record<AtsId, Reader> = {
  greenhouse: {
    jobs: (data) => listAt(data, 'jobs'),
    read: (job) => {
      // "Remote, Canada; Remote, Poland; Remote, United Kingdom"
      const places = nameOf(job.location)
        .split(';')
        .map((place) => place.trim())
        .filter(Boolean);
      return {
        id: str(job.id),
        title: str(job.title),
        url: str(job.absolute_url),
        company: str(job.company_name),
        places,
        remote: places.some((place) => /remote/i.test(place)),
      };
    },
  },
  lever: {
    jobs: (data) => (Array.isArray(data) ? data : null),
    read: (job) => {
      const categories = isObj(job.categories) ? job.categories : {};
      const places = arr(categories.allLocations).map(str).filter(Boolean);
      if (!places.length && str(categories.location)) places.push(str(categories.location));
      // the main place's country, as a code: Poland's is what the remote check needs to know
      if (str(job.country) === 'PL' && !places.some((place) => /poland|polska/i.test(place))) places.push('Poland');
      return {
        id: str(job.id),
        title: str(job.text),
        url: str(job.hostedUrl),
        places,
        remote: str(job.workplaceType) === 'remote',
      };
    },
  },
  ashbyhq: {
    // a job left off the company's job board is in the API too
    jobs: (data) => listAt(data, 'jobs')?.filter((job) => !isObj(job) || job.isListed !== false) ?? null,
    read: (job) => {
      const address = isObj(job.address) && isObj(job.address.postalAddress) ? job.address.postalAddress : {};
      const country = str(address.addressCountry);
      const main = str(job.location);
      const places = [
        country && main && !main.includes(country) ? `${main}, ${country}` : main || country,
        ...arr(job.secondaryLocations).map((place) => (isObj(place) ? str(place.location) : '')),
      ].filter(Boolean);
      // isRemote is true on hybrid jobs too; the workplace type says which
      const type = str(job.workplaceType);
      return {
        id: str(job.id),
        title: str(job.title),
        url: str(job.jobUrl),
        places,
        remote: type ? type === 'Remote' : job.isRemote === true,
      };
    },
  },
  workable: {
    jobs: (data) => listAt(data, 'jobs'),
    read: (job, data) => {
      const places = arr(job.locations)
        .filter((place) => isObj(place) && place.hidden !== true)
        .map((place) => (isObj(place) ? [str(place.city), str(place.country)].filter(Boolean).join(', ') : ''))
        .filter(Boolean);
      return {
        id: str(job.shortcode),
        title: str(job.title),
        url: str(job.url) || str(job.shortlink),
        company: isObj(data) ? str(data.name) : '',
        places: places.length ? places : [[str(job.city), str(job.country)].filter(Boolean).join(', ')].filter(Boolean),
        remote: job.telecommuting === true,
      };
    },
  },
  smartrecruiters: {
    jobs: (data) => listAt(data, 'content'),
    read: (job) => {
      const location = isObj(job.location) ? job.location : {};
      const company = isObj(job.company) ? job.company : {};
      const place =
        str(location.fullLocation) || [str(location.city), str(location.country)].filter(Boolean).join(', ');
      return {
        id: str(job.id),
        title: str(job.name),
        // its API gives the API's own link (ref); the job's page is this
        url:
          str(company.identifier) && str(job.id)
            ? `https://jobs.smartrecruiters.com/${str(company.identifier)}/${str(job.id)}`
            : '',
        company: str(company.name),
        places: place ? [place] : [],
        remote: location.remote === true,
      };
    },
  },
};

// where a job remote from there may be done from Poland (the words folded: lowercase, no accents)
const OPEN = /\b(poland|polska|europe|european union|eu|emea|cet|worldwide|anywhere|global)\b/;
const REMOTE_WORDS = /\b(fully |100% )?remote\b|\bzdaln\p{L}*|\bwork from home\b/gu;

/**
 * A job remote only from another country ("Remote, France", "Remote - US") is not remote for you: it
 * counts as remote when a place it names is Poland or Europe-wide, or it names none besides "Remote", or
 * its title says so ("… - EMEA Remote", with an office in Paris as its place). The others go through the
 * city filter with their places instead.
 */
export function remoteHere(remote: boolean, places: string[], title = ''): boolean {
  if (!remote) return false;
  if (OPEN.test(fold(title))) return true;
  const named = places
    .map((place) =>
      fold(place)
        .replace(REMOTE_WORDS, ' ')
        .replace(/[^\p{L}\p{N}]+/gu, ' ')
        .trim(),
    )
    .filter(Boolean);
  return !named.length || named.some((place) => OPEN.test(place));
}

/** "acme-labs" -> "Acme labs": the company's name when the ATS doesn't give one */
const fromCompanyId = (company: string) => {
  const words = company.replace(/[-_.]+/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
};

/** a job as the Settings test shows it: its long texts (Lever's descriptions) cut short */
const shortened = (job: unknown) =>
  isObj(job)
    ? Object.fromEntries(
        Object.entries(job).map(([key, value]) => [
          key,
          typeof value === 'string' && value.length > 300 ? `${value.slice(0, 300)}…` : value,
        ]),
      )
    : job;

export const parseAts: ListingParser = (body, { src, url }) => {
  const ats = atsOf(url);
  if (!ats) throw new Error(`Not a careers page of a supported ATS: ${url}`);
  const data = json(body, `The ${ats.label} answer`);
  const jobs = READERS[ats.id].jobs(data);
  if (!jobs) throw new Error(`${ats.label}: no jobs list (got ${keysOf(data)})`);
  return {
    total: jobs.length,
    sample: sampleOf(shortened(jobs[0])),
    items: jobs.filter(isObj).map((raw) => {
      const job = READERS[ats.id].read(raw, data);
      return {
        src,
        id: job.id,
        title: job.title,
        company: job.company || fromCompanyId(ats.company),
        seniority: seniorityOf(job.title),
        remote: remoteHere(job.remote, job.places, job.title),
        url: job.url,
        locations: job.places,
        skills: [],
      };
    }),
  };
};
