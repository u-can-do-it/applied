// The schema.org JobPosting in a page (what Google Jobs reads): most boards' ad pages have one.
import { htmlToText } from '../shared/html';
import { CONTRACTS, day, money, asString, unique, unit, type Ad, type JobDetails } from './details';

const asText = (value: unknown): string => {
  if (value == null) return '';
  if (Array.isArray(value)) return value.map(asText).filter(Boolean).join(', ');
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return asText(record.name ?? record.description ?? record.value ?? record.credentialCategory ?? '');
  }
  return htmlToText(value);
};

export function findJobPosting(html: string): Record<string, unknown> | null {
  for (const match of html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    let data: unknown;
    try {
      data = JSON.parse(match[1]);
    } catch {
      continue;
    }
    const stack: unknown[] = [data];
    while (stack.length) {
      const node = stack.pop();
      if (!node || typeof node !== 'object') continue;
      if (Array.isArray(node)) {
        stack.push(...(node as unknown[]));
        continue;
      }
      const record = node as Record<string, unknown>;
      if (([] as unknown[]).concat(record['@type'] ?? []).includes('JobPosting')) return record;
      if (record['@graph']) stack.push(record['@graph']);
    }
  }
  return null;
}

function detailsFromJobPosting(jp: Record<string, unknown>): JobDetails {
  const salaries = ([] as unknown[]).concat(jp.baseSalary ?? []).map((raw) => {
    const salary = raw as {
      currency?: string;
      value?: { minValue?: number; maxValue?: number; value?: number; unitText?: string };
    } | null;
    const value = salary?.value ?? {};
    const range =
      value.minValue != null && value.maxValue != null
        ? `${money(value.minValue)}–${money(value.maxValue)}`
        : money(value.value ?? value.minValue ?? value.maxValue);
    return range
      ? `${range} ${salary?.currency ?? ''}${value.unitText ? ` / ${unit(value.unitText)}` : ''}`
          .replace(/\s+/g, ' ')
          .trim()
      : undefined;
  });
  const places = ([] as unknown[])
    .concat(jp.jobLocation ?? [])
    .map((place) => (place as { address?: { addressLocality?: string } } | null)?.address?.addressLocality);
  return {
    salary: unique(salaries).join('; ') || undefined,
    contract:
      unique(
        ([] as unknown[]).concat(jp.employmentType ?? []).map((type) => CONTRACTS[asString(type)] ?? asString(type)),
      ).join(', ') || undefined,
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
    .filter(([, value]) => value)
    .map(([label, value]) => `${label}: ${value}`);
  return { text: [...parts, asText(jp.description)].filter(Boolean).join('\n\n'), details: detailsFromJobPosting(jp) };
}
