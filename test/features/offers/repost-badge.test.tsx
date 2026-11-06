// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { RepostOf } from '@/lib/db/repos/reposts';
import { outcomeHeading, stageOf } from '@/lib/stages';
import { RepostBadge, repostTitle } from '@/features/offers/repost-badge';
import { hintOf, render } from '@/test/render';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
}));

afterEach(cleanup);

const TZ = 'Europe/Warsaw';
const earlier: RepostOf = {
  jobId: 'acme|reactdeveloper',
  src: 'bulldog',
  id: '1',
  title: 'React Developer',
  company: 'Acme',
  url: 'https://bulldog.example/1',
  firstSeen: '2026-09-16T17:10:00.000Z',
  appliedAt: null,
  status: null,
};
const applied = { ...earlier, appliedAt: '2026-10-28T10:00:00.000Z' };
const rejected = { ...applied, status: { stage: 'technical', outcome: 'failed' } } satisfies RepostOf;

const badge = (of: RepostOf) => {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <RepostBadge of={of} labels={{}} tz={TZ} />
    </QueryClientProvider>,
  );
  return screen.getByRole('button');
};

const ghosted = { ...applied, status: { stage: 'submitted', outcome: 'ghosted' } } satisfies RepostOf;

it('says "repost" whatever became of the earlier job; its colour, how your application to it went', () => {
  const cases: [RepostOf, string][] = [
    [earlier, 'quiet'], // not applied to
    [{ ...applied, status: { stage: 'technical', outcome: 'pending' } }, 'brand'],
    [{ ...applied, status: { stage: 'invited', outcome: 'withdrawn' } }, 'brand'],
    [ghosted, 'warning'],
    [rejected, 'danger'],
  ];
  for (const [of, variant] of cases) {
    const button = badge(of);
    expect([button.textContent, button.dataset.variant]).toEqual(['repost', variant]);
    cleanup();
  }
});

it('its title: when it was first seen, when you applied, and if they said no or went quiet, that', () => {
  expect(hintOf(badge(rejected))).toBe(
    `Repost of “React Developer”, first seen Wed 16.09.2026; you applied on 28.10.2026, rejected at ${stageOf('technical').label}. A click opens it.`,
  );
  expect(repostTitle(earlier, TZ)).toBe('Repost of “React Developer”, first seen Wed 16.09.2026. A click opens it.');
  expect(repostTitle(applied, TZ)).toContain('; you applied on 28.10.2026. A click');
  expect(repostTitle(ghosted, TZ)).toContain(
    `you applied on 28.10.2026, ${outcomeHeading('ghosted').toLowerCase()}: they went quiet.`,
  );
  expect(repostTitle({ ...applied, status: { stage: 'submitted', outcome: 'failed' } }, TZ)).toContain(
    'you applied on 28.10.2026, rejected. A click',
  );
  expect(repostTitle({ ...applied, status: { stage: 'offer', outcome: 'failed' } }, TZ)).toContain(
    'you applied on 28.10.2026, the offer was taken back.',
  );
});
