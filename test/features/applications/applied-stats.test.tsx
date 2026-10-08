// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { ListedApplication } from '@/lib/applications';
import { AppliedStats } from '@/features/applications/applied-stats';
import { RENT_A_DEV } from '@/features/offers/rent-a-dev';

afterEach(cleanup);

const app = (bodyLeasing: boolean | null, verdict: boolean | null = null) =>
  ({
    stage: 'submitted',
    outcome: 'pending',
    history: [],
    bodyLeasing,
    fit: verdict === null ? null : { bodyLeasing: verdict },
  }) as unknown as ListedApplication;

it('counts Rent-a-dev / normal in a last tile that is no filter', () => {
  const setFilter = vi.fn();
  // its own call, else the verdict's; one nothing said either way about counts in neither
  const apps = [app(true), app(true), app(null, true), app(false), app(false, true), app(null)];
  render(<AppliedStats apps={apps} filter={null} setFilter={setFilter} />);

  const label = screen.getByText(`${RENT_A_DEV.label} / normal`);
  const tile = label.closest('[aria-disabled="true"]');
  expect(tile).not.toBeNull();
  expect(tile?.textContent).toContain('3 / 2');
  expect(tile?.textContent).toContain('60%');
  expect(tile?.querySelector('button')).toBeNull();
  // the last of the tiles
  expect(tile?.parentElement?.lastElementChild).toBe(tile);
});
