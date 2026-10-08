// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { assessFitAction } from '@/features/applications/actions';
import { useFitCheck } from '@/features/applications/application-fit';
import { applicationKey, type Shown } from '@/features/applications/use-application';
import type { Fit } from '@/lib/ai/profiles';

// "Check the fit again" in the edit: the AI judges the job once its ad text is in, not on the title alone.

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
  return renderHook(() => useFitCheck(JOB, onError), {
    wrapper: ({ children }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>,
  });
}
const shownFit = () => queryClient.getQueryData<Shown>(applicationKey(JOB))?.fit;

beforeEach(() => {
  vi.clearAllMocks();
  assess.mockResolvedValue({ ok: true, data: fit });
});

describe('useFitCheck', () => {
  it('checks again at once when the ad text is in, and the new verdict replaces the old one', async () => {
    const hook = setUp({ ...app, fit: { ...fit, score: 20 } });
    act(() => hook.result.current.checkAgain(JOB));
    expect(hook.result.current.checking).toBe(true);
    await waitFor(() => expect(shownFit()?.score).toBe(80));
    // the application's own call on body leasing follows the check
    expect(queryClient.getQueryData<Shown>(applicationKey(JOB))?.bodyLeasing).toBe(false);
    expect(assess).toHaveBeenCalledExactlyOnceWith({ jobId: JOB });
    expect(hook.result.current.checking).toBe(false);
  });

  it('waits while the ad text is being fetched', async () => {
    const hook = setUp({ ...app, content: null, contentStatus: 'pending' });
    act(() => hook.result.current.checkAgain(JOB));
    await Promise.resolve();
    expect(assess).not.toHaveBeenCalled();
    expect(hook.result.current.checking).toBe(true);

    act(() => {
      queryClient.setQueryData(applicationKey(JOB), app);
    });
    await waitFor(() => expect(shownFit()).toEqual(fit));
    expect(assess).toHaveBeenCalledOnce();
  });

  it('asks nothing when the window closed before the ad text came in', async () => {
    const hook = setUp({ ...app, content: null, contentStatus: 'pending' });
    act(() => hook.result.current.checkAgain(JOB));
    act(() => queryClient.removeQueries({ queryKey: applicationKey(JOB) }));
    await waitFor(() => expect(hook.result.current.checking).toBe(false));
    expect(assess).not.toHaveBeenCalled();
  });

  it('says what went wrong', async () => {
    assess.mockResolvedValue({ ok: false, error: 'No AI profile to check it with.' });
    const hook = setUp(app);
    act(() => hook.result.current.check());
    await waitFor(() => expect(onError).toHaveBeenLastCalledWith('No AI profile to check it with.'));
    expect(shownFit()).toBeUndefined();
  });
});
