// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import type { ListedApplication } from '@/lib/applications';
import { TooltipProvider } from '@/components/ui/tooltip';
import { ApplicationRow } from '@/features/applications/application-row';

afterEach(cleanup);

const app = (fit: ListedApplication['fit']) =>
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
    fit,
  }) as unknown as ListedApplication;

const row = (fit: ListedApplication['fit']) => {
  render(
    <TooltipProvider>
      <ApplicationRow app={app(fit)} labels={{ justjoin: 'JustJoin' }} onOpen={() => {}} />
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
  });
  expect(screen.getByText('82%').dataset.variant).toBe('success-soft');
  expect(screen.getByText('React and TypeScript, remote').className).toContain('text-brand');
  expect(button.querySelector('.lucide-sparkles')).not.toBeNull();
  expect(button.querySelector('button')).toBeNull();
});

it('ruled out by your criteria: grey with a cross', () => {
  row({ match: false, score: 82, summary: null, checks: [], hadDescription: true });
  expect(screen.getByText('Ruled out by your criteria:').parentElement?.dataset.variant).toBe('muted');
});

it('not judged: no badge, no line', () => {
  const button = row(null);
  expect(button.textContent).not.toMatch(/%/);
  expect(button.querySelector('.lucide-sparkles')).toBeNull();
});
