// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';
import { JobRow } from '@/features/offers/job-row';

afterEach(cleanup);

const verdict = { match: true, score: 72, summary: 'React fits.', checks: [], hadDescription: true };

const row = (props: { verdict?: typeof verdict; matching?: boolean }) =>
  render(
    <TooltipProvider>
      <ul>
        <li>
          <JobRow
            title="Frontend Developer"
            company="Acme"
            facts={[]}
            rentADev={false}
            boards={[]}
            labels={{}}
            {...props}
          />
        </li>
      </ul>
    </TooltipProvider>,
  );

it('a job the AI is matching: "matching…" where the fit badge goes', () => {
  row({ matching: true });
  expect(screen.getByText('matching…')).toBeTruthy();
});

it('once judged: its score, no longer "matching…"', () => {
  row({ verdict, matching: true });
  expect(screen.queryByText('matching…')).toBeNull();
  expect(screen.getByRole('button').textContent).toBe('72%');
});

it('one the AI isn’t checking (it can’t, or it failed): neither', () => {
  row({});
  expect(screen.queryByText('matching…')).toBeNull();
  expect(screen.queryByRole('button')).toBeNull();
});
