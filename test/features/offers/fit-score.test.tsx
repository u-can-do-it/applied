// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';
import { FitScore } from '@/features/offers/fit-score';

afterEach(cleanup);

const badge = (match: boolean) => {
  render(
    <TooltipProvider>
      <FitScore match={match} score={85} summary={null} checks={[]} hadDescription />
    </TooltipProvider>,
  );
  return screen.getByRole('button');
};

it('a match: its score, coloured by it', () => {
  const button = badge(true);
  expect(button.textContent).toBe('85%');
  expect(button.dataset.variant).toBe('success-soft');
});

it('ruled out by your criteria: grey with a cross, whatever its score', () => {
  const button = badge(false);
  expect(button.textContent).toBe('Ruled out by your criteria: 85%');
  expect(button.dataset.variant).toBe('muted');
});
