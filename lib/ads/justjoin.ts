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
  const offer = (await (
    await get(`https://justjoin.it/api/candidate-api/offers/${encodeURIComponent(slug)}`, 'application/json')
  ).json()) as JustjoinOffer;
  const skills = (xs: Skill[] | undefined) =>
    (xs ?? [])
      .map((skill) => (skill.level ? `${skill.name} (${skill.level}/5)` : skill.name))
      .filter(Boolean)
      .join(', ');
  const text = [
    skills(offer.requiredSkills) && `Must have: ${skills(offer.requiredSkills)}`,
    skills(offer.niceToHaveSkills) && `Nice to have: ${skills(offer.niceToHaveSkills)}`,
    offer.experienceLevel && `Seniority: ${offer.experienceLevel}`,
    offer.languages?.length && `Languages: ${languages(offer.languages)}`,
    htmlToText(offer.body),
  ]
    .filter(Boolean)
    .join('\n\n');

  const amount = (perUnit?: number, monthly?: number) => {
    const value = perUnit ?? monthly;
    return value == null ? undefined : Math.round(value * 100) / 100;
  };
  const pay = (offer.employmentTypes ?? []).filter((employment) => employment.currencySource !== 'conversion');
  const workplace = asString(offer.workplaceType);
  const details: JobDetails = {
    salary:
      unique(
        pay
          .filter((employment) => employment.from || employment.to)
          .map((employment) =>
            `${[amount(employment.fromPerUnit, employment.from), amount(employment.toPerUnit, employment.to)]
              .filter((value) => value != null)
              .map(money)
              .join(
                '–',
              )} ${employment.currency?.toUpperCase() ?? ''} / ${unit(employment.unit)} (${CONTRACTS[employment.type ?? ''] ?? employment.type})`.replace(
              /\s+/g,
              ' ',
            ),
          ),
      ).join('; ') || undefined,
    contract:
      unique(pay.map((employment) => CONTRACTS[employment.type ?? ''] ?? employment.type)).join(', ') || undefined,
    location: offer.city
      ? `${offer.city}${workplace === 'hybrid' ? ' (hybrid)' : workplace === 'office' ? ' (office)' : ''}`
      : undefined,
    remote: workplace === 'remote' || undefined,
    posted: day(offer.publishedAt),
    validUntil: day(offer.expiredAt),
    company: offer.companyName || undefined,
  };
  return { text, details };
}

export const readJustjoin: AdReader = async (offer) => {
  try {
    return await fromApi(offer.id);
  } catch {
    return readPage(offer.url); // API changed or down: the page's JobPosting still has the text
  }
};
