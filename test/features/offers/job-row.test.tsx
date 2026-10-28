// @vitest-environment jsdom
import type { ComponentProps } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';
import { appliedHere, detailFacts, JobRow } from '@/features/offers/job-row';
import { WindowButton } from '@/features/offers/row-box';
import { NavProvider } from '@/features/offers/nav';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
}));

afterEach(cleanup);

const verdict = { match: true, score: 72, summary: 'React fits.', checks: [], hadDescription: true };

const row = (props: Partial<ComponentProps<typeof JobRow>>) =>
  render(
    <NavProvider>
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
      </TooltipProvider>
    </NavProvider>,
  );

it('a job the AI is matching: "matching…" where the fit badge goes', () => {
  row({ matching: true });
  expect(screen.getByText('matching…')).toBeTruthy();
});

it('once judged: its score, no longer "matching…"', () => {
  row({ verdict, matching: true });
  expect(screen.queryByText('matching…')).toBeNull();
  expect(screen.getByRole('button', { name: /%/ }).textContent).toBe('72%');
});

it('one the AI isn’t checking (it can’t, or it failed): neither', () => {
  row({});
  expect(screen.queryByText('matching…')).toBeNull();
  // only the title's copy button
  expect(screen.getAllByRole('button').map((button) => button.getAttribute('aria-label'))).toEqual(['Copy the title']);
});

it('with companyHref, the company links there', () => {
  row({ companyHref: '/?src=solid&q=Acme' });
  expect(screen.getByRole('link', { name: 'Acme' }).getAttribute('href')).toBe('/?src=solid&q=Acme');
});

it('with onCompany, the company is a button that does it', () => {
  const onCompany = vi.fn();
  row({ onCompany });
  fireEvent.click(screen.getByRole('button', { name: 'Acme' }));
  expect(onCompany).toHaveBeenCalledOnce();
});

it('the title opens the offer in a new tab; a board badge its own', () => {
  row({ href: 'https://justjoin.example/1', boards: [{ src: 'nofluff', url: 'https://nofluff.example/2' }] });
  const title = screen.getByRole('link', { name: 'Frontend Developer' });
  expect([title.getAttribute('href'), title.getAttribute('target')]).toEqual(['https://justjoin.example/1', '_blank']);
  expect(screen.getByRole('link', { name: 'nofluff' }).getAttribute('href')).toBe('https://nofluff.example/2');
});

it('a click on the row opens its window; one on a link, a button or the company is theirs', () => {
  const open = vi.fn();
  const onCompany = vi.fn();
  row({
    href: 'https://justjoin.example/1',
    onCompany,
    facts: [{ key: 'salary', text: '20 000 PLN / month' }],
    verdict,
    after: <WindowButton title="Frontend Developer" onClick={open} />,
  });
  fireEvent.click(screen.getByText('20 000 PLN / month'));
  fireEvent.click(screen.getByText('React fits.'));
  expect(open).toHaveBeenCalledTimes(2);
  fireEvent.click(screen.getByRole('link', { name: 'Frontend Developer' }));
  fireEvent.click(screen.getByRole('button', { name: 'Acme' }));
  fireEvent.click(screen.getByRole('button', { name: /72%/ }));
  expect(open).toHaveBeenCalledTimes(2);
  expect(onCompany).toHaveBeenCalledOnce();
  // the window's own button: once, not again by the row
  fireEvent.click(screen.getByRole('button', { name: 'Details of Frontend Developer' }));
  expect(open).toHaveBeenCalledTimes(3);
});

it('pointing at the row, or tabbing to its window button, starts loading the window', () => {
  const prefetch = vi.fn();
  row({
    facts: [{ key: 'salary', text: '20 000 PLN / month' }],
    after: <WindowButton title="Frontend Developer" onPrefetch={prefetch} />,
  });
  const button = screen.getByRole('button', { name: 'Details of Frontend Developer' });
  const rowBox = button.closest('[data-row]');
  expect(rowBox).not.toBeNull();
  fireEvent.pointerEnter(rowBox as Element);
  expect(prefetch).toHaveBeenCalledOnce();
  fireEvent.focus(button);
  expect(prefetch).toHaveBeenCalledTimes(2);
});

it('the details line: salary (the first), contract, work mode, where; else the listing’s remote', () => {
  const texts = (facts: ReturnType<typeof detailFacts>) => facts.map((fact) => fact.text);
  expect(
    texts(
      detailFacts({
        salary: '19 300–21 000 PLN / month; 120 PLN / hour (B2B)',
        contract: 'B2B / contract',
        workMode: 'remote',
        location: 'Warszawa',
      }),
    ),
  ).toEqual(['19 300–21 000 PLN / month', 'B2B / contract', 'Remote', 'Warszawa']);
  expect(texts(detailFacts({ workMode: 'hybrid', officeDays: '2 office / 3 home' }, true))).toEqual([
    'Hybrid (2 office / 3 home)',
  ]);
  expect(texts(detailFacts(undefined, true))).toEqual(['Remote']);
  expect(texts(detailFacts(undefined, false))).toEqual(['Office / hybrid']);
  expect(texts(detailFacts(null))).toEqual([]);
});

describe('appliedHere', () => {
  it('says how many applications you have at the company, none too', () => {
    expect(appliedHere({ count: 0, last: null, self: false })).toBe('No applications here');
    expect(appliedHere({ count: 1, last: '12.10.2026', self: true })).toBe(
      '1 application here (this job), on 12.10.2026',
    );
    expect(appliedHere({ count: 1, last: '12.10.2026', self: false })).toBe('1 application here, on 12.10.2026');
    expect(appliedHere({ count: 3, last: '12.10.2026', self: true })).toBe(
      '3 applications here (this job among them), the latest on 12.10.2026',
    );
    expect(appliedHere({ count: 2, last: '12.10.2026', self: false })).toBe(
      '2 applications here, the latest on 12.10.2026',
    );
  });
});
