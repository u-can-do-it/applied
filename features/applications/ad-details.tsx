import type { Application } from '@/lib/applications';
import { workModeText } from '@/lib/ads/details';
import { formatDay } from '@/lib/dates';

/**
 * What the ad says about the job: salary, contract, where and how, when. The first four always
 * show ("not given" when the ad doesn't say: Edit can fill them in); the dates only when there are any.
 */
export function AdDetails({ details }: { details: Application['details'] }) {
  const rows: [string, string | undefined, 'always'?][] = [
    ['Salary', details?.salary, 'always'],
    ['Contract', details?.contract, 'always'],
    ['Location', details?.location, 'always'],
    ['Work mode', workModeText(details), 'always'],
    ['Posted', details?.posted ? formatDay(details.posted) : undefined],
    ['Valid until', details?.validUntil ? formatDay(details.validUntil) : undefined],
  ];
  return (
    <dl className="m-0 grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-x-4 gap-y-2 rounded-lg border bg-background px-3 py-2.5">
      {rows
        .filter(([, value, always]) => value || always)
        .map(([label, value]) => (
          <div key={label} className={label === 'Salary' && value?.includes('; ') ? 'col-span-2' : undefined}>
            <dt className="text-[11px] tracking-[0.05em] text-muted-foreground uppercase">{label}</dt>
            {/* one line per contract type: "14 000–18 000 PLN / month (B2B)" */}
            <dd className="mt-0.5 ml-0 text-sm">
              {value ? (
                value.split('; ').map((line, i) => (
                  <span key={i} className="block">
                    {line}
                  </span>
                ))
              ) : (
                <span className="text-muted-foreground">Not given</span>
              )}
            </dd>
          </div>
        ))}
    </dl>
  );
}
