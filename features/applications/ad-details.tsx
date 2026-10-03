import type { Application } from '@/lib/applications';
import { formatDay } from '@/lib/dates';

/** What the ad says about the job: salary, contract, where, when; nothing when it says none of it. */
export function AdDetails({ details }: { details: Application['details'] }) {
  const rows: [string, string | undefined][] = [
    ['Salary', details?.salary],
    ['Contract', details?.contract],
    ['Location', [details?.remote ? 'Remote' : null, details?.location].filter(Boolean).join(' · ') || undefined],
    ['Posted', details?.posted ? formatDay(details.posted) : undefined],
    ['Valid until', details?.validUntil ? formatDay(details.validUntil) : undefined],
  ];
  if (!rows.some(([, value]) => value)) return null;
  return (
    <dl className="m-0 grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-x-4 gap-y-2 rounded-lg border bg-background px-3 py-2.5">
      {rows
        .filter((row): row is [string, string] => Boolean(row[1]))
        .map(([label, value]) => (
          <div key={label} className={label === 'Salary' && value.includes('; ') ? 'col-span-2' : undefined}>
            <dt className="text-[11px] tracking-[0.05em] text-muted-foreground uppercase">{label}</dt>
            {/* one line per contract type: "14 000–18 000 PLN / month (B2B)" */}
            <dd className="mt-0.5 ml-0 text-sm">
              {value.split('; ').map((line, i) => (
                <span key={i} className="block">
                  {line}
                </span>
              ))}
            </dd>
          </div>
        ))}
    </dl>
  );
}
