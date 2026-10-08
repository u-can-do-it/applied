// The ATSs (a company's own recruiting system) an `ats` scraper reads a company's open jobs from: its careers
// link -> the ATS's public API, which needs no key. Their answers are read in parsers/ats.ts. Shared by the
// server and the Settings page.

export type AtsId = 'greenhouse' | 'lever' | 'ashbyhq' | 'workable' | 'smartrecruiters';

type Ats = {
  /** offers.src of what it finds: the name boardOf() gives its job links (jobs.ashbyhq.com -> ashbyhq) */
  id: AtsId;
  label: string;
  /** the company's name on the ATS, from its careers link or one of its job links */
  company(url: URL): string | null;
  /** the API that lists the company's open jobs */
  api(company: string, url: URL): string;
};

const COMPANY = /^[A-Za-z0-9._-]{1,100}$/;
const firstPart = (url: URL) => url.pathname.split('/').find(Boolean) ?? null;
/** The company, when the link is on one of the ATS's hosts. */
const on = (hosts: RegExp, url: URL, company = firstPart(url)) =>
  hosts.test(url.hostname.toLowerCase()) && company && COMPANY.test(company) ? company : null;

const ATSES: Ats[] = [
  {
    id: 'greenhouse',
    label: 'Greenhouse',
    // job-boards.greenhouse.io/acme, boards.greenhouse.io/acme, boards.greenhouse.io/embed/job_board?for=acme
    company: (url) => on(/^(job-)?boards\.greenhouse\.io$/, url, url.searchParams.get('for') ?? firstPart(url)),
    api: (company) => `https://boards-api.greenhouse.io/v1/boards/${company}/jobs`,
  },
  {
    id: 'lever',
    label: 'Lever',
    // an account hosted in the EU has its jobs and its API there
    company: (url) => on(/^jobs\.(eu\.)?lever\.co$/, url),
    api: (company, url) =>
      `https://api.${url.hostname.toLowerCase().startsWith('jobs.eu.') ? 'eu.' : ''}lever.co/v0/postings/${company}?mode=json`,
  },
  {
    id: 'ashbyhq',
    label: 'Ashby',
    company: (url) => on(/^jobs\.ashbyhq\.com$/, url),
    api: (company) => `https://api.ashbyhq.com/posting-api/job-board/${company}`,
  },
  {
    id: 'workable',
    label: 'Workable',
    // apply.workable.com/j/<code> is one job, whose link doesn't name the company
    company: (url) => (firstPart(url) === 'j' ? null : on(/^apply\.workable\.com$/, url)),
    api: (company) => `https://apply.workable.com/api/v1/widget/accounts/${company}`,
  },
  {
    id: 'smartrecruiters',
    label: 'SmartRecruiters',
    company: (url) => on(/^(careers|jobs)\.smartrecruiters\.com$/, url),
    // its most (100) per call: a big company is narrowed by the link's own country, city or q (?country=pl)
    api: (company, url) => {
      const query = new URLSearchParams({ limit: '100' });
      for (const param of ['country', 'city', 'q']) {
        const value = url.searchParams.get(param);
        if (value) query.set(param, value);
      }
      return `https://api.smartrecruiters.com/v1/companies/${company}/postings?${query}`;
    },
  },
];

/** "Greenhouse, Lever, Ashby, Workable or SmartRecruiters" */
export const ATS_NAMES = `${ATSES.slice(0, -1)
  .map((ats) => ats.label)
  .join(', ')} or ${ATSES[ATSES.length - 1].label}`;

/** The ATS a careers link is on and the company it names; null for any other link. */
export function atsOf(link: string): { id: AtsId; label: string; company: string; api: string } | null {
  let url: URL;
  try {
    url = new URL(link.trim());
  } catch {
    return null;
  }
  for (const ats of ATSES) {
    const company = ats.company(url);
    if (company) return { id: ats.id, label: ats.label, company, api: ats.api(company, url) };
  }
  return null;
}

/** The link as it is requested: the ATS's API for the company the careers link names. */
export function atsApiUrl(link: string): string {
  const found = atsOf(link);
  if (!found) throw new Error(`Not a careers page on ${ATS_NAMES}`);
  return found.api;
}
