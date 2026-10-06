// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { AdDetails } from '@/features/applications/ad-details';

afterEach(cleanup);

const dots = (item: HTMLElement) => [...item.querySelectorAll('[aria-hidden] > span')];

it('shows the tech stack as a row of its own: each level in words, and as dots out of 5', () => {
  render(
    <AdDetails
      details={{
        salary: '20 000 PLN / month (B2B)',
        skills: [
          { name: 'English', note: 'C1' },
          { name: 'React', level: 4 },
          { name: 'Docker', level: 1 },
        ],
      }}
    />,
  );
  expect(screen.getByText('Tech stack')).toBeTruthy();
  const [english, react, docker] = screen.getAllByRole('listitem');
  expect(within(english).getByText('C1')).toBeTruthy();
  expect(dots(english)).toHaveLength(0); // a language: its level, no dots
  expect(within(react).getByText('Advanced')).toBeTruthy();
  expect(dots(react).map((dot) => dot.classList.contains('bg-brand'))).toEqual([true, true, true, true, false]);
  expect(within(docker).getByText('Nice to have')).toBeTruthy();
});

it('no skills read (or none named): no row', () => {
  render(<AdDetails details={{ salary: 'x', skills: [] }} />);
  expect(screen.queryByText('Tech stack')).toBeNull();
});
