// @vitest-environment jsdom
import { cleanup, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { ListedApplication } from '@/lib/applications';
import { AppliedStats } from '@/features/applications/applied-stats';
import { RENT_A_DEV } from '@/features/offers/rent-a-dev';
import { TILES, tileTitle } from '@/features/applications/status-filter';
import { ANSWER_TIME_HEADINGS } from '@/features/applications/answer-table';
import { outcomeLabel, stageOf } from '@/lib/stages';
import { hintOf, render } from '@/test/render';

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

it('the Ghosted tile says what it counts (its hint); the others’ names say it', () => {
  render(<AppliedStats apps={[app(null)]} filter={null} setFilter={vi.fn()} />);
  const tile = (label: string) => screen.getByRole('button', { name: new RegExp(label) });
  expect(hintOf(tile(TILES.ghosted.label))).toBe(tileTitle('ghosted'));
  expect(hintOf(tile(TILES.rejected.label))).toBeNull();
});

it('says how long they took to answer, by the status they answered with', () => {
  const rejected = (days: number) =>
    ({
      ...app(null),
      outcome: 'failed',
      history: [
        { stage: 'submitted', state: 'pending', at: '2026-10-01T10:00:00Z' },
        {
          stage: 'submitted',
          state: 'failed',
          at: new Date(Date.parse('2026-10-01T10:00:00Z') + days * 86400_000).toISOString(),
        },
      ],
    }) as unknown as ListedApplication;
  render(<AppliedStats apps={[rejected(2), rejected(10), app(null)]} filter={null} setFilter={vi.fn()} />);

  const heading = screen.getByRole('rowheader', {
    name: `${stageOf('submitted').label} · ${outcomeLabel('submitted', 'failed')}`,
  });
  const cells = [...(heading.closest('tr')?.children ?? [])].map((cell) => cell.textContent);
  expect(cells).toEqual([heading.textContent, '2', '2 days', '6 days', '10 days']);
  const headings = [...(heading.closest('table')?.querySelectorAll('thead th') ?? [])].map((th) => th.textContent);
  expect(headings).toEqual(ANSWER_TIME_HEADINGS);
});

it('no answers yet: says so', () => {
  render(<AppliedStats apps={[app(null)]} filter={null} setFilter={vi.fn()} />);
  expect(screen.getByText('No answers yet.')).toBeTruthy();
});
