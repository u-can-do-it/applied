import 'server-only';
import { arr, isObj, str } from '../listings/extract';
import { ELDORADO_MCP, searchEldorado } from '../listings/eldorado-mcp';
import { day, money, type AdReader, type JobDetails, type WorkMode } from './details';

// Eldorado: its job pages answer this server with Cloudflare's challenge (403), so the ad comes from its MCP
// server's search by id (#<id>, lib/listings/eldorado-mcp.ts): what Eldorado lists about the job, as the text and
// the details. The ad's own text it doesn't give.

const CONTRACTS: Partial<Record<string, string>> = {
  b2b: 'B2B',
  employment_contract: 'Employment contract (UoP)',
  mandate_contract: 'Mandate (zlecenie)',
  internship: 'Internship',
};
const WORKLOADS: Partial<Record<string, string>> = { full_time: 'full-time', part_time: 'part-time' };

/** The most flexible mode it offers: remote if it may be done remotely, else hybrid, else on site. */
function workModeOf(modes: string[]): WorkMode | undefined {
  if (modes.includes('remote')) return 'remote';
  if (modes.includes('hybrid')) return 'hybrid';
  return modes.includes('office') ? 'onsite' : undefined;
}

/** Eldorado's monthly figure in PLN (an hourly or daily rate converted): "25 200–31 500 PLN / month". */
function salaryOf(from: unknown, to: unknown) {
  const amounts = [from, to].filter((amount): amount is number => typeof amount === 'number');
  if (!amounts.length) return undefined;
  const range =
    amounts.length === 2 ? amounts.map(money).join('–') : `${from === null ? 'up to' : 'from'} ${money(amounts[0])}`;
  return `${range} PLN / month`;
}

export const readEldorado: AdReader = async (offer) => {
  if (!/^\d+$/.test(offer.id)) return { text: '', details: {} }; // not one of its job ids
  const answer: unknown = JSON.parse(
    await searchEldorado(`${ELDORADO_MCP}?phrase=${encodeURIComponent(`#${offer.id}`)}`),
  );
  const job = (isObj(answer) ? arr(answer.jobs) : [])
    .filter(isObj)
    .find((one) => new RegExp(`/praca/${offer.id}(?:-|$|\\?)`).test(str(one.url)));
  if (!job) return { text: '', details: {} }; // gone from Eldorado
  const modes = arr(job.work_modes).map(str);
  const workMode = workModeOf(modes);
  const contracts = arr(job.contract_types).map((type) => CONTRACTS[str(type)] ?? str(type));
  const workloads = arr(job.workload_types).map((type) => WORKLOADS[str(type)] ?? str(type));
  const cities = arr(job.cities).map(str).filter(Boolean);
  const skills = arr(job.keywords).map(str).filter(Boolean);
  const salary = salaryOf(job.salary_from, job.salary_to);
  const details: JobDetails = {
    company: str(job.company) || undefined,
    salary: salary && `${salary} (Eldorado’s figure)`,
    contract: [...contracts, ...workloads].join(', ') || undefined,
    location: cities.join(', ') || undefined,
    workMode,
    remote: workMode === 'remote' || undefined,
    posted: day(job.posted_at),
    skills: skills.map((name) => ({ name })),
  };
  const seniority = str(job.seniority);
  const lines = [
    `What Eldorado lists about it (its ad page can’t be read from this server):`,
    `${str(job.title)}${details.company ? ` at ${details.company}` : ''}.`,
    skills.length ? `Skills: ${skills.join(', ')}.` : '',
    seniority && seniority !== 'other' ? `Seniority: ${seniority}.` : '',
    modes.length ? `Work mode: ${modes.join(', ')}.` : '',
    cities.length ? `Places: ${cities.join(', ')}.` : '',
    details.contract ? `Contract: ${details.contract}.` : '',
    salary ? `Salary: ${salary}.` : '',
  ];
  return { text: lines.filter(Boolean).join('\n'), details };
};
