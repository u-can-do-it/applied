import type { Application } from '@/lib/applications';
import { SKILL_LEVELS, skillLevelText, workModeText, type Skill } from '@/lib/ads/details';
import { formatDay } from '@/lib/dates';
import { cn } from '@/lib/shared/cn';

/**
 * What the ad says about the job: salary, contract, where and how, when, and its tech stack. The
 * first four always show ("not given" when the ad doesn't say: Edit can fill them in); the dates and
 * the skills only when there are any.
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
            <dt className={labelClass}>{label}</dt>
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
      {details?.skills?.length ? <TechStack skills={details.skills} /> : null}
    </dl>
  );
}

const labelClass = 'text-[11px] tracking-[0.05em] text-muted-foreground uppercase';

/** A row of its own: each skill with its level in words and as dots (1–5), JustJoin's way. */
function TechStack({ skills }: { skills: Skill[] }) {
  return (
    <div className="col-span-full">
      <dt className={labelClass}>Tech stack</dt>
      <dd className="mt-1.5 ml-0">
        <ul className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(110px,1fr))] gap-x-4 gap-y-2.5 p-0">
          {skills.map((skill, i) => {
            const level = skillLevelText(skill);
            return (
              <li key={`${skill.name}-${i}`} className="min-w-0">
                <span className="block truncate text-sm font-semibold" title={skill.name}>
                  {skill.name}
                </span>
                {level && <span className="block text-[11px] text-muted-foreground">{level}</span>}
                {skill.level ? (
                  <span className="mt-1 flex gap-0.5" aria-hidden>
                    {SKILL_LEVELS.map((_, dot) => (
                      <span
                        key={dot}
                        className={cn('h-1.5 w-3 rounded-full', dot < (skill.level ?? 0) ? 'bg-brand' : 'bg-muted')}
                      />
                    ))}
                  </span>
                ) : null}
              </li>
            );
          })}
        </ul>
      </dd>
    </div>
  );
}
