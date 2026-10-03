'use client';

import { useRef, useState } from 'react';
import { CheckIcon, InfoIcon, XIcon } from 'lucide-react';

type Check = { item: string; met: boolean };

/**
 * "82%" and an info icon, with the requirement checklist on hover / focus / tap. The tip opens below the
 * badge, or above it when there isn't room below (the last offers on the screen).
 */
export function FitScore({
  tipId,
  score,
  summary,
  checks,
  hadDescription,
}: {
  tipId: string;
  score: number;
  summary: string | null;
  checks: Check[];
  hadDescription: boolean;
}) {
  const badge = useRef<HTMLSpanElement>(null);
  const tip = useRef<HTMLSpanElement>(null);
  const [up, setUp] = useState(false);

  // the tip is visible by now (CSS :hover / :focus), so its real height can be measured
  const place = () =>
    requestAnimationFrame(() => {
      if (!badge.current || !tip.current) return;
      const box = badge.current.getBoundingClientRect();
      const below = window.innerHeight - box.bottom;
      setUp(below < tip.current.offsetHeight + 12 && box.top > below);
    });

  const tier = score >= 70 ? 'high' : score >= 40 ? 'mid' : 'low';
  const met = checks.filter((check) => check.met).length;

  return (
    <span
      ref={badge}
      className={`fit fit-${tier}`}
      data-up={up ? '' : undefined}
      tabIndex={0}
      aria-describedby={tipId}
      onMouseEnter={place}
      onFocus={place}
    >
      {score}%
      <InfoIcon className="fit-info" />
      <span ref={tip} className="fit-tip" role="tooltip" id={tipId}>
        <strong>
          {score}% fit{checks.length > 0 && ` · ${met}/${checks.length} requirements met`}
        </strong>
        {summary && <span className="fit-summary">{summary}</span>}
        {checks.length > 0 && (
          <span className="fit-checks">
            {checks.map((check, i) => (
              <span key={i} className={check.met ? 'met' : 'miss'}>
                {check.met ? <CheckIcon /> : <XIcon />} {check.item}
                <span className="sr-only">{check.met ? ' (you have it)' : ' (missing)'}</span>
              </span>
            ))}
          </span>
        )}
        {!hadDescription && (
          <span className="fit-note">Judged on the title only – the ad text couldn&apos;t be read.</span>
        )}
      </span>
    </span>
  );
}
