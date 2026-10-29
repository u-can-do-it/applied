import 'server-only';
import { parsePage, scriptById, type Page } from '../dom';
import { isObj, str } from '../listings/extract';
import { contractOf, money, unique, unit, type Ad, type AdReader } from './details';
import { get } from './fetch';
import { findJobPosting, fromJobPosting } from './job-posting';

// Solid.jobs: the page's JobPosting, as for any board; but its salary is the board's monthly figure (an hourly
// rate converted: "16 800–23 500 PLN / month" for 100–140 PLN / hour) and only the first contract's, so the
// salaries come from the page's Angular state (ng-state: the offer API's jobOfferDetails), as the ad gives them:
// salaryRange, and secondarySalaryRange when it has a second contract.

/** "100–140 PLN / hour (B2B)"; undefined when there's no amount. */
function salaryOf(range: unknown) {
  if (!isObj(range)) return undefined;
  const amounts = unique([range.lowerBound, range.upperBound].map((amount) => (amount == null ? '' : money(amount))));
  if (!amounts.length) return undefined;
  const period = str(range.salaryPeriod);
  const contract = str(range.employmentType);
  return `${amounts.join('–')} ${str(range.currency)}${period ? ` / ${unit(period)}` : ''}${contract ? ` (${contractOf(contract).note})` : ''}`.replace(
    /\s+/g,
    ' ',
  );
}

/** The salaries and contracts in the page's state; nothing when it hasn't them. */
function contractsOf(page: Page): { salary?: string; contract?: string } {
  let state: unknown = null;
  try {
    state = JSON.parse(scriptById(page, 'ng-state') ?? 'null');
  } catch {
    // not JSON: nothing in it
  }
  // its entries are the page's API answers, by a hash of the request: the offer's has its jobOfferDetails
  const offer = Object.values(isObj(state) ? state : {})
    .map((entry) => (isObj(entry) && isObj(entry.b) ? entry.b.jobOfferDetails : null))
    .find(isObj);
  const ranges = [offer?.salaryRange, offer?.secondarySalaryRange].filter(isObj);
  return {
    salary: unique(ranges.map(salaryOf)).join('; ') || undefined,
    contract:
      unique(ranges.map((range) => str(range.employmentType) && contractOf(str(range.employmentType)).name)).join(
        ', ',
      ) || undefined,
  };
}

export const readSolidjobs: AdReader = async ({ url }) => {
  const page = parsePage(await (await get(url, 'text/html')).text());
  const jp = findJobPosting(page);
  const ad: Ad = jp ? fromJobPosting(jp) : { text: '', details: {} };
  const { salary, contract } = contractsOf(page);
  return {
    text: ad.text,
    details: {
      ...ad.details,
      salary: salary ?? ad.details.salary,
      contract: contract ?? ad.details.contract,
    },
  };
};
