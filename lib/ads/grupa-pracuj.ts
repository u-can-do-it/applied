import 'server-only';
import { parsePage, scriptById, type Page } from '../dom';
import { arr, isObj, nameOf, str, type Obj } from '../listings/extract';
import { contractOf, money, unique, type Ad, type AdReader } from './details';
import { get } from './fetch';
import { findJobPosting, fromJobPosting } from './job-posting';

// Grupa Pracuj's boards, The Protocol and Pracuj.pl: the page's JobPosting, as for any board; but its salary is
// one range for all the contracts, without the period or whether it's gross ("16 000–19 000 PLN" for a job also
// paying 90–125 PLN / hour on B2B), so the salaries (and so the contracts) come from the page's __NEXT_DATA__
// (the offer's attributes.employment.typesOfContracts), one a contract, as the page shows them.

const CURRENCIES: Partial<Record<string, string>> = { zł: 'PLN', '€': 'EUR', $: 'USD', '£': 'GBP' };
// its periods by id (0 a month, 1 an hour, as recorded 2026-10-21), else by their words
const PERIODS: [RegExp, string][] = [
  [/mies|month/i, 'month'],
  [/godz|hour/i, 'hour'],
  [/dzie|day/i, 'day'],
  [/rok|roczn|year/i, 'year'],
];
const PERIOD_IDS: Partial<Record<number, string>> = { 0: 'month', 1: 'hour' };

// The Protocol's forms are words ("mies."), Pracuj.pl's are { name: "mies." }; its id on the salary, or on its unit
const periodOf = (salary: Obj) => {
  const timeUnit = isObj(salary.timeUnit) ? salary.timeUnit : {};
  const unit = `${nameOf(timeUnit.shortForm)} ${nameOf(timeUnit.longForm)}`;
  const id = salary.timeUnitId ?? timeUnit.id;
  return PERIODS.find(([pattern]) => pattern.test(unit))?.[1] ?? (typeof id === 'number' ? PERIOD_IDS[id] : undefined);
};

/** "brutto" → "gross", "netto (+ VAT)" → "net + VAT". */
const kindOf = (kind: string) =>
  /brutto|gross/i.test(kind) ? 'gross' : /netto|net/i.test(kind) ? `net${/VAT/i.test(kind) ? ' + VAT' : ''}` : '';

/** "10 000–17 000 PLN net + VAT / month (B2B)"; undefined when the ad hides it. */
function salaryOf(salary: unknown, contract: string) {
  if (!isObj(salary)) return undefined;
  const [from, to] = [salary.from, salary.to].map((amount) => (typeof amount === 'number' ? amount : null));
  const range =
    from !== null && to !== null && from !== to
      ? `${money(from)}–${money(to)}`
      : from !== null || to !== null
        ? `${from === null ? 'up to ' : ''}${money(from ?? to)}`
        : '';
  if (!range) return undefined;
  // The Protocol's on the salary (currencyCode, kindCode), Pracuj.pl's in objects (currency.code, salaryKind.name)
  const currency =
    str(salary.currencyCode) ||
    str(salary.currencySymbol) ||
    (isObj(salary.currency) ? str(salary.currency.code) || str(salary.currency.symbol) : '');
  const kind = str(salary.kindCode) || str(salary.kindName) || nameOf(salary.salaryKind);
  const period = periodOf(salary);
  return [range, CURRENCIES[currency] ?? currency, kindOf(kind)]
    .filter(Boolean)
    .join(' ')
    .concat(period ? ` / ${period}` : '', ` (${contract})`)
    .replace(/\s+/g, ' '); // its thousands' (no-break) space too
}

/** The salaries and contracts in the page's data; nothing when it hasn't them. */
function contractsOf(page: Page): { salary?: string; contract?: string } {
  let data: unknown = null;
  try {
    data = JSON.parse(scriptById(page, '__NEXT_DATA__') ?? 'null');
  } catch {
    // not JSON: nothing in it
  }
  const props = isObj(data) && isObj(data.props) && isObj(data.props.pageProps) ? data.props.pageProps : {};
  // The Protocol's: the page's offer; Pracuj.pl's: the data of its dehydrated query that has the offer's attributes
  const queries = isObj(props.dehydratedState) ? arr(props.dehydratedState.queries) : [];
  const offer =
    props.offer ??
    queries
      .map((query) => (isObj(query) && isObj(query.state) ? query.state.data : null))
      .find((found) => isObj(found) && isObj(found.attributes));
  const attributes = isObj(offer) && isObj(offer.attributes) ? offer.attributes : {};
  const employment = isObj(attributes.employment) ? attributes.employment : {};
  const contracts = arr(employment.typesOfContracts)
    .filter(isObj)
    .map((type) => ({ ...contractOf(str(type.name).trim()), salary: type.salary }))
    .filter((type) => type.name);
  return {
    salary: unique(contracts.map(({ salary, note }) => salaryOf(salary, note))).join('; ') || undefined,
    contract: unique(contracts.map(({ name }) => name)).join(', ') || undefined,
  };
}

export const readGrupaPracuj: AdReader = async ({ url }) => {
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
