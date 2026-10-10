// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { toast } from 'sonner';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TimeZone } from '@/components/time-zone';
import { TooltipProvider } from '@/components/ui/tooltip';
import { applyAction } from '@/features/applications/actions';
import { archiveAction, setJobNoteAction } from '@/features/offers/actions';
import { ArchiveRow } from '@/features/offers/archive';
import { NOTE_PLACEHOLDER, OfferSheet, type OfferJob } from '@/features/offers/offer-sheet';
import { offerKey } from '@/features/offers/use-offer';
import type { OfferWindow } from '@/lib/offer-window';

// An offer's window: what the list has at once, the ad and the note as they load; "Mark applied" takes
// the note along (saved first), Archive takes the row out of the list.

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/features/applications/actions', () => ({ applyAction: vi.fn(), assessFitAction: vi.fn() }));
vi.mock('@/features/offers/actions', () => ({
  setJobNoteAction: vi.fn(),
  assessJobFitAction: vi.fn(),
  archiveAction: vi.fn(),
  restoreAction: vi.fn(),
}));
const apply = vi.mocked(applyAction);
const saveNote = vi.mocked(setJobNoteAction);
const archive = vi.mocked(archiveAction);

const JOB = 'rossmannsdp|lidertechnologiczny';
const AT = '2026-10-09T08:00:00.000Z';
const job: OfferJob = {
  jobId: JOB,
  src: 'eldorado',
  id: '455630',
  title: 'Lider Technologiczny',
  company: 'Rossmann SDP',
  url: 'https://czyjesteldorado.pl/praca/455630',
  firstSeen: '2026-10-10T09:00:00.000Z',
  ai: { match: true, score: 15, summary: 'ERP and WMS', checks: [], hadDescription: true, bodyLeasing: false },
};
const window: OfferWindow = {
  content: 'Biegłość w technologiach backendowych (np. .NET / C#)',
  contentStatus: 'ok',
  contentError: null,
  scrapedAt: AT,
  details: { contract: 'B2B', location: 'Warszawa' },
  fit: job.ai ?? null,
  note: 'Ask about the WMS',
  noteUpdatedAt: AT,
};

function open({ inRow = false } = {}) {
  const queryClient = new QueryClient();
  queryClient.setQueryData(offerKey(JOB), window);
  const onClose = vi.fn();
  const sheet = <OfferSheet job={job} labels={{ eldorado: 'Eldorado' }} onClose={onClose} />;
  render(
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <TimeZone tz="Europe/Warsaw">
          {inRow ? (
            <ul>
              <ArchiveRow jobId={JOB} title={job.title} archived={false}>
                <li>{sheet}</li>
              </ArchiveRow>
            </ul>
          ) : (
            sheet
          )}
        </TimeZone>
      </TooltipProvider>
    </QueryClientProvider>,
  );
  return { onClose };
}
const note = () => screen.getByPlaceholderText<HTMLTextAreaElement>(NOTE_PLACEHOLDER);

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  // the window checks again as it opens: the same answer
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve(Response.json(window))),
  );
  apply.mockResolvedValue({ ok: true, data: undefined });
  archive.mockResolvedValue({ ok: true, data: undefined });
  saveNote.mockResolvedValue({ ok: true, data: { noteUpdatedAt: '2026-10-10T10:00:00.000Z' } });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('an offer window', () => {
  it('the offer, its ad with the board’s details, and your note', () => {
    open();
    expect(screen.getByRole('heading', { name: job.title })).toBeTruthy();
    expect(screen.getByText(/Rossmann SDP · Eldorado · first seen/)).toBeTruthy();
    expect(screen.getByText('15%')).toBeTruthy();
    expect(screen.getByText(window.content ?? '')).toBeTruthy();
    expect(screen.getByText('B2B')).toBeTruthy();
    expect(note().value).toBe('Ask about the WMS');
    expect(screen.getByRole('link', { name: /Open on Eldorado/ }).getAttribute('href')).toBe(job.url);
  });

  it('"Mark applied" saves what you typed first: the note goes with it to the application', async () => {
    const { onClose } = open();
    fireEvent.change(note(), { target: { value: 'Ask about the WMS and .NET' } });
    fireEvent.click(screen.getByRole('button', { name: 'Mark applied' }));
    await waitFor(() => expect(apply).toHaveBeenCalledExactlyOnceWith({ jobId: JOB, src: 'eldorado', id: '455630' }));
    expect(saveNote).toHaveBeenCalledWith({ jobId: JOB, note: 'Ask about the WMS and .NET', seenAt: AT });
    expect(saveNote.mock.invocationCallOrder[0]).toBeLessThan(apply.mock.invocationCallOrder[0]);
    expect(toast.success).toHaveBeenCalledWith(`Marked applied: “${job.title}”`);
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('a failed mark says why and stays open', async () => {
    apply.mockResolvedValue({ ok: false, error: 'That offer is no longer in the database.' });
    const { onClose } = open();
    fireEvent.click(screen.getByRole('button', { name: 'Mark applied' }));
    expect(await screen.findByText('That offer is no longer in the database.')).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('Archive takes the offer out of the list', async () => {
    open({ inRow: true });
    fireEvent.click(screen.getByRole('button', { name: 'Archive' }));
    await waitFor(() => expect(archive).toHaveBeenCalledExactlyOnceWith({ jobId: JOB }));
  });
});
