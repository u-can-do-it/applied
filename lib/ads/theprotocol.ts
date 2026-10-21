import 'server-only';
import { parsePage, scriptById, type Page } from '../dom';
import { arr, isObj, str, type Obj } from '../listings/extract';
import { money, unique, type Ad, type AdReader } from './details';
import { get } from './fetch';
import { findJobPosting, fromJobPosting } from './job-posting';

// The Protocol: the page's JobPosting, as for any board; but its salary is one range for all the contracts,
// without the period or whether it's gross, so the salaries (and so the contracts) come from the page's
// __NEXT_DATA__ (offer.attributes.employment.typesOfContracts), one a contract, as the page shows them.

/** Its contracts' names, in the ad's language ("umowa o pracę", "kontrakt B2B"…): ours, and the salary's note. */
const CONTRACTS: [RegExp, string, string][] = [
  [/B2B/i, 'B2B', 'B2B'],
  [/tymczasow|temporary/i, 'Temporary', 'temporary'], // "umowa o pracę tymczasową", before "o pracę"
  [/o pracę|employment/i, 'Permanent (UoP)', 'UoP'],
  [/zleceni|mandate/i, 'Mandate (zlecenie)', 'zlecenie'],
  [/dzieło|specific/i, 'Specific-task (o dzieło)', 'o dzieło'],
  [/staż|praktyk|intern/i, 'Internship', 'internship'],
];
const CURRENCIES: Partial<Record<string, string>> = { zł: 'PLN', '€': 'EUR', $: 'USD', '£': 'GBP' };
// its periods by id (0 a month, 1 an hour, as recorded 2026-10-21), else by their words
const PERIODS: [RegExp, string][] = [
  [/mies|month/i, 'month'],
  [/godz|hour/i, 'hour'],
  [/dzie|day/i, 'day'],
  [/rok|roczn|year/i, 'year'],
];
const PERIOD_IDS: Partial<Record<number, string>> = { 0: 'month', 1: 'hour' };

const contractOf = (name: string) => {
  const known = CONTRACTS.find(([pattern]) => pattern.test(name));
  return known ? { name: known[1], note: known[2] } : { name, note: name };
};

const periodOf = (salary: Obj) => {
  const unit = isObj(salary.timeUnit) ? `${str(salary.timeUnit.shortForm)} ${str(salary.timeUnit.longForm)}` : '';
  return (
    PERIODS.find(([pattern]) => pattern.test(unit))?.[1] ??
    (typeof salary.timeUnitId === 'number' ? PERIOD_IDS[salary.timeUnitId] : undefined)
  );
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
  const currency = str(salary.currencyCode) || str(salary.currencySymbol);
  const period = periodOf(salary);
  return [range, CURRENCIES[currency] ?? currency, kindOf(str(salary.kindCode) || str(salary.kindName))]
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
  const offer = isObj(data) && isObj(data.props) && isObj(data.props.pageProps) ? data.props.pageProps.offer : null;
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

export const readTheprotocol: AdReader = async ({ url }) => {
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
