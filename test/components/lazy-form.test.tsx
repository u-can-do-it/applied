// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { use } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LazyForm, LOAD_FAILED } from '@/components/lazy-form';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { ApplicationFormHeader } from '@/features/applications/application-form-header';

const never = new Promise<never>(() => {});
function StillLoading() {
  use(never); // suspends, as a lazy component does until its code is in
  return null;
}
function NotLoaded(): never {
  throw new Error('Failed to load chunk');
}

const inSheet = (children: React.ReactNode) =>
  render(
    <Sheet open>
      <SheetContent>
        <LazyForm header={<ApplicationFormHeader editing={false} />}>{children}</LazyForm>
      </SheetContent>
    </Sheet>,
  );

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('LazyForm', () => {
  it('shows the window’s header and grey fields while the form loads, with nothing for Radix to warn about', () => {
    const warn = vi.spyOn(console, 'warn');
    const error = vi.spyOn(console, 'error');
    inSheet(<StillLoading />);
    expect(screen.getByRole('dialog', { name: 'Add an application' })).toBeTruthy();
    expect(document.querySelector('[aria-busy="true"]')).toBeTruthy();
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });

  it('says so in the window when the form’s code can’t be loaded', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {}); // React reports the caught error
    inSheet(<NotLoaded />);
    expect(screen.getByText(LOAD_FAILED)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Reload' })).toBeTruthy();
  });
});
