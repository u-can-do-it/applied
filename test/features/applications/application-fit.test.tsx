// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { assessFitAction } from '@/features/applications/actions';
import { ApplicationFit, useFitCheck } from '@/features/applications/application-fit';
import { applicationKey, type Shown } from '@/features/applications/use-application';
import { TooltipProvider } from '@/components/ui/tooltip';
import type { Fit } from '@/lib/ai/profiles';

// The fit in the application's window: asked once, or again with the button beside the score.

vi.mock('@/features/applications/actions', () => ({ assessFitAction: vi.fn() }));
const assess = vi.mocked(assessFitAction);

const JOB = 'acme|reactdev';
const fit: Fit = { match: true, score: 80, summary: 'Fits', checks: [], hadDescription: true, bodyLeasing: false };
const app = { jobId: JOB, title: 'React Dev', content: 'The ad text', contentStatus: 'ok' } as Shown;

let queryClient: QueryClient;
const onError = vi.fn();
function setUp(shown: Shown | undefined) {
  queryClient = new QueryClient();
  if (shown) queryClient.setQueryData(applicationKey(JOB), shown);
  return renderHook(() => useFitCheck(applicationKey(JOB), () => assess({ jobId: JOB }), onError), {
    wrapper: ({ children }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>,
  });
}
const shownFit = () => queryClient.getQueryData<Shown>(applicationKey(JOB))?.fit;

beforeEach(() => {
  vi.clearAllMocks();
  assess.mockResolvedValue({ ok: true, data: fit });
});
afterEach(cleanup);

describe('useFitCheck', () => {
  it('checks again, and the new verdict replaces the old one', async () => {
    const hook = setUp({ ...app, fit: { ...fit, score: 20 } });
    act(() => hook.result.current.check());
    expect(hook.result.current.checking).toBe(true);
    await waitFor(() => expect(shownFit()?.score).toBe(80));
    // the application's own call on body leasing follows the check
    expect(queryClient.getQueryData<Shown>(applicationKey(JOB))?.bodyLeasing).toBe(false);
    expect(assess).toHaveBeenCalledExactlyOnceWith({ jobId: JOB });
    expect(hook.result.current.checking).toBe(false);
  });

  it('says what went wrong', async () => {
    assess.mockResolvedValue({ ok: false, error: 'No AI profile to check it with.' });
    const hook = setUp(app);
    act(() => hook.result.current.check());
    await waitFor(() => expect(onError).toHaveBeenLastCalledWith('No AI profile to check it with.'));
    expect(shownFit()).toBeUndefined();
  });
});

describe('ApplicationFit', () => {
  const show = (shown: Shown, onCheck = vi.fn()) => {
    render(
      <TooltipProvider>
        <ApplicationFit app={shown} checking={false} onCheck={onCheck} />
      </TooltipProvider>,
    );
    return onCheck;
  };
  const again = () => screen.queryByRole('button', { name: 'Check the fit again' });

  it('a judged job: the score, and a button beside it that asks again', () => {
    const onCheck = show({ ...app, fit });
    expect(screen.getByText('80%')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Check the fit again' }));
    expect(onCheck).toHaveBeenCalledOnce();
  });

  it('not while the ad text is being fetched (it would be judged on the title alone)', () => {
    show({ ...app, fit, content: null, contentStatus: 'pending' });
    expect((again() as HTMLButtonElement).disabled).toBe(true);
  });

  it('a job not judged yet has "Check fit" instead', () => {
    show({ ...app, fit: null });
    expect(again()).toBeNull();
    expect(screen.getByRole('button', { name: 'Check fit' })).toBeTruthy();
  });
});
