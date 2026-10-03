// The schema.org JobPosting in a page (what Google Jobs reads): most boards' ad pages have one.
import { htmlToText } from '../shared/html';
import { CONTRACTS, day, money, asString, unique, unit, type Ad, type JobDetails } from './details';

const asText = (v: unknown): string => {
  if (v == null) return '';
  if (Array.isArray(v)) return v.map(asText).filter(Boolean).join(', ');
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return asText(o.name ?? o.description ?? o.value ?? o.credentialCategory ?? '');
  }
  return htmlToText(v);
};

export function findJobPosting(html: string): Record<string, unknown> | null {
  for (const m of html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    let data: unknown;
    try {
      data = JSON.parse(m[1]);
    } catch {
      continue;
    }
    const stack: unknown[] = [data];
    while (stack.length) {
      const x = stack.pop();
      if (!x || typeof x !== 'object') continue;
      if (Array.isArray(x)) {
        stack.push(...(x as unknown[]));
        continue;
      }
      const o = x as Record<string, unknown>;
      if (([] as unknown[]).concat(o['@type'] ?? []).includes('JobPosting')) return o;
      if (o['@graph']) stack.push(o['@graph']);
    }
  }
  return null;
}

function detailsFromJobPosting(jp: Record<string, unknown>): JobDetails {
  const salaries = ([] as unknown[]).concat(jp.baseSalary ?? []).map((s) => {
    const m = s as {
      currency?: string;
      value?: { minValue?: number; maxValue?: number; value?: number; unitText?: string };
    } | null;
    const v = m?.value ?? {};
    const range =
      v.minValue != null && v.maxValue != null
        ? `${money(v.minValue)}–${money(v.maxValue)}`
        : money(v.value ?? v.minValue ?? v.maxValue);
    return range
      ? `${range} ${m?.currency ?? ''}${v.unitText ? ` / ${unit(v.unitText)}` : ''}`.replace(/\s+/g, ' ').trim()
      : undefined;
  });
  const places = ([] as unknown[])
    .concat(jp.jobLocation ?? [])
    .map((p) => (p as { address?: { addressLocality?: string } } | null)?.address?.addressLocality);
  return {
    salary: unique(salaries).join('; ') || undefined,
    contract:
      unique(([] as unknown[]).concat(jp.employmentType ?? []).map((t) => CONTRACTS[asString(t)] ?? asString(t))).join(
        ', ',
      ) || undefined,
    location: unique(places).join(', ') || undefined,
    remote: asString(jp.jobLocationType).toUpperCase() === 'TELECOMMUTE' || undefined,
    posted: day(jp.datePosted),
    validUntil: day(jp.validThrough),
    company: asText((jp.hiringOrganization as { name?: string } | undefined)?.name) || undefined,
  };
}

export function fromJobPosting(jp: Record<string, unknown>): Ad {
  const parts = [
    ['Skills', asText(jp.skills)],
    ['Experience', asText(jp.experienceRequirements)],
    ['Qualifications', asText(jp.qualifications)],
    ['Responsibilities', asText(jp.responsibilities)],
  ]
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}: ${v}`);
  return { text: [...parts, asText(jp.description)].filter(Boolean).join('\n\n'), details: detailsFromJobPosting(jp) };
}
