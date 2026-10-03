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
import { readPage } from './page';

// JustJoin: its public offer API (formatted body, skills, salary). Its JobPosting text has its list
// items glued together, so it is only the fallback.

type Skill = { name?: string; level?: number };
// employmentTypes also lists conversions to other currencies: keep the offer's own
// from / to are monthly amounts; fromPerUnit / toPerUnit are per `unit` (100 PLN / hour, not 16 800)
type Pay = {
  from?: number;
  to?: number;
  fromPerUnit?: number;
  toPerUnit?: number;
  currency?: string;
  currencySource?: string;
  type?: string;
  unit?: string;
};
// the parts of the offer API that are read below; all of it may be missing
type JustjoinOffer = {
  requiredSkills?: Skill[];
  niceToHaveSkills?: Skill[];
  experienceLevel?: string;
  languages?: Language[];
  body?: string;
  employmentTypes?: Pay[];
  workplaceType?: string;
  city?: string;
  publishedAt?: string;
  expiredAt?: string;
  companyName?: string;
};

async function fromApi(slug: string) {
  const j = (await (
    await get(`https://justjoin.it/api/candidate-api/offers/${encodeURIComponent(slug)}`, 'application/json')
  ).json()) as JustjoinOffer;
  const skills = (xs: Skill[] | undefined) =>
    (xs ?? [])
      .map((x) => (x.level ? `${x.name} (${x.level}/5)` : x.name))
      .filter(Boolean)
      .join(', ');
  const text = [
    skills(j.requiredSkills) && `Must have: ${skills(j.requiredSkills)}`,
    skills(j.niceToHaveSkills) && `Nice to have: ${skills(j.niceToHaveSkills)}`,
    j.experienceLevel && `Seniority: ${j.experienceLevel}`,
    j.languages?.length && `Languages: ${languages(j.languages)}`,
    htmlToText(j.body),
  ]
    .filter(Boolean)
    .join('\n\n');

  const amount = (perUnit?: number, monthly?: number) => {
    const v = perUnit ?? monthly;
    return v == null ? undefined : Math.round(v * 100) / 100;
  };
  const pay = (j.employmentTypes ?? []).filter((e) => e.currencySource !== 'conversion');
  const workplace = asString(j.workplaceType);
  const details: JobDetails = {
    salary:
      unique(
        pay
          .filter((e) => e.from || e.to)
          .map((e) =>
            `${[amount(e.fromPerUnit, e.from), amount(e.toPerUnit, e.to)]
              .filter((x) => x != null)
              .map(money)
              .join(
                '–',
              )} ${e.currency?.toUpperCase() ?? ''} / ${unit(e.unit)} (${CONTRACTS[e.type ?? ''] ?? e.type})`.replace(
              /\s+/g,
              ' ',
            ),
          ),
      ).join('; ') || undefined,
    contract: unique(pay.map((e) => CONTRACTS[e.type ?? ''] ?? e.type)).join(', ') || undefined,
    location: j.city
      ? `${j.city}${workplace === 'hybrid' ? ' (hybrid)' : workplace === 'office' ? ' (office)' : ''}`
      : undefined,
    remote: workplace === 'remote' || undefined,
    posted: day(j.publishedAt),
    validUntil: day(j.expiredAt),
    company: j.companyName || undefined,
  };
  return { text, details };
}

export const readJustjoin: AdReader = async (copy) => {
  try {
    return await fromApi(copy.id);
  } catch {
    return readPage(copy.url); // API changed or down: the page's JobPosting still has the text
  }
};
