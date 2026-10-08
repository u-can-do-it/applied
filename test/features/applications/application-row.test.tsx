// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import type { ListedApplication } from '@/lib/applications';
import { TooltipProvider } from '@/components/ui/tooltip';
import { ApplicationRow } from '@/features/applications/application-row';
import { RENT_A_DEV } from '@/features/offers/rent-a-dev';

afterEach(cleanup);

const app = (fit: ListedApplication['fit'], bodyLeasing: boolean | null = null) =>
  ({
    jobId: 'j1',
    src: 'justjoin',
    title: 'Frontend Developer',
    company: 'Acme',
    details: null,
    note: null,
    stage: 'submitted',
    outcome: 'pending',
    contentStatus: 'ok',
    bodyLeasing,
    fit,
  }) as unknown as ListedApplication;

const row = (fit: ListedApplication['fit'], bodyLeasing: boolean | null = null) => {
  render(
    <TooltipProvider>
      <ApplicationRow app={app(fit, bodyLeasing)} labels={{ justjoin: 'JustJoin' }} onOpen={() => {}} />
    </TooltipProvider>,
  );
  return screen.getByRole('button');
};

it('a judged job: its fit badge and the verdict’s line, inside the row (no button in the button)', () => {
  const button = row({
    match: true,
    score: 82,
    summary: 'React and TypeScript, remote',
    checks: [],
    hadDescription: true,
    bodyLeasing: false,
  });
  expect(screen.getByText('82%').dataset.variant).toBe('success-soft');
  expect(screen.getByText('React and TypeScript, remote').className).toContain('text-brand');
  expect(button.querySelector('.lucide-sparkles')).not.toBeNull();
  expect(button.querySelector('button')).toBeNull();
});

it('ruled out by your criteria: grey with a cross', () => {
  row({ match: false, score: 82, summary: null, checks: [], hadDescription: true, bodyLeasing: null });
  expect(screen.getByText('Ruled out by your criteria:').parentElement?.dataset.variant).toBe('muted');
});

it('not judged: no badge, no line', () => {
  const button = row(null);
  expect(button.textContent).not.toMatch(/%/);
  expect(button.querySelector('.lucide-sparkles')).toBeNull();
});

it('Rent-a-dev: by the verdict, unless the application has its own call on it', () => {
  const fit = { match: true, score: 60, summary: null, checks: [], hadDescription: true, bodyLeasing: true };
  row(fit);
  expect(screen.getByText(RENT_A_DEV.label).title).toBe(RENT_A_DEV.title);
  cleanup();
  row(fit, false); // its own call: not one
  expect(screen.queryByText(RENT_A_DEV.label)).toBeNull();
  cleanup();
  row(null, true); // not judged, but its own call says it is
  expect(screen.getByText(RENT_A_DEV.label)).not.toBeNull();
  cleanup();
  row({ ...fit, bodyLeasing: null }); // judged before it was asked
  expect(screen.queryByText(RENT_A_DEV.label)).toBeNull();
});
