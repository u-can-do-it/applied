// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { toast } from 'sonner';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ListSearch } from '@/components/list-search';
import { TimeZone } from '@/components/time-zone';
import { TooltipProvider } from '@/components/ui/tooltip';
import { applyAction } from '@/features/applications/actions';
import {
  archiveAction,
  assessJobFitAction,
  setJobAdAction,
  setJobAdFromLinkAction,
  setJobNoteAction,
} from '@/features/offers/actions';
import { AD_PLACEHOLDER, LINK_PLACEHOLDER } from '@/features/offers/ad-editor';
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
  setJobAdAction: vi.fn(),
  setJobAdFromLinkAction: vi.fn(),
  assessJobFitAction: vi.fn(),
  archiveAction: vi.fn(),
  restoreAction: vi.fn(),
}));
const apply = vi.mocked(applyAction);
const saveNote = vi.mocked(setJobNoteAction);
const archive = vi.mocked(archiveAction);
const assess = vi.mocked(assessJobFitAction);
const saveAd = vi.mocked(setJobAdAction);
const readAd = vi.mocked(setJobAdFromLinkAction);

const JOB = 'rossmannsdp|lidertechnologiczny';
const AT = '2026-10-09T08:00:00.000Z';
const fit = { match: true, score: 15, summary: 'ERP and WMS', checks: [], hadDescription: true, bodyLeasing: false };
const job: OfferJob = {
  jobId: JOB,
  src: 'eldorado',
  id: '455630',
  title: 'Lider Technologiczny',
  company: 'Rossmann SDP',
  url: 'https://czyjesteldorado.pl/praca/455630',
  firstSeen: '2026-10-10T09:00:00.000Z',
  ai: fit,
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

function open({
  inRow = false,
  shown = window,
  search = { query: '', everything: false },
}: { inRow?: boolean; shown?: OfferWindow; search?: { query: string; everything: boolean } } = {}) {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve(Response.json(shown))),
  );
  const queryClient = new QueryClient();
  queryClient.setQueryData(offerKey(JOB), shown);
  const onClose = vi.fn();
  const sheet = <OfferSheet job={job} labels={{ eldorado: 'Eldorado' }} onClose={onClose} />;
  render(
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <TimeZone tz="Europe/Warsaw">
          <ListSearch {...search}>
            {inRow ? (
              <ul>
                <ArchiveRow jobId={JOB} title={job.title} archived={false}>
                  <li>{sheet}</li>
                </ArchiveRow>
              </ul>
            ) : (
              sheet
            )}
          </ListSearch>
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
  // the window checks again as it opens: the same answer (open())
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

  it('the list’s search: its words marked in what it searched, the ad too when it read everything', () => {
    const marked = () => [...document.querySelectorAll('mark')].map((mark) => mark.textContent);
    open({ search: { query: 'rossmann wms c# warszawa', everything: false } });
    // the note's under its textarea, which can't mark its own text
    expect(marked()).toEqual(['Rossmann', 'WMS']);
    cleanup();
    open({ search: { query: 'rossmann wms c# warszawa', everything: true } });
    expect(marked()).toEqual(['Rossmann', 'WMS', 'Warszawa', 'C#']);
    expect(note().value).toBe('Ask about the WMS'); // the textarea's text as it was
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

  it('a verdict on the title alone is made again from the ad the window has, once; never without an ad', async () => {
    const titleOnly = { ...window, fit: { ...fit, hadDescription: false } };
    assess.mockResolvedValue({ ok: true, data: fit });
    open({ shown: titleOnly });
    await waitFor(() => expect(assess).toHaveBeenCalledWith({ jobId: JOB }));
    // the window's own load answers with the old verdict again (here): still once
    await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalled());
    expect(assess).toHaveBeenCalledOnce();
    cleanup();
    assess.mockClear();
    open({ shown: { ...titleOnly, content: null, contentStatus: 'empty' } });
    open();
    await waitFor(() => expect(screen.getAllByText('15%')).toHaveLength(2));
    expect(assess).not.toHaveBeenCalled();
  });

  describe('the ad, yours to edit: it saves itself', () => {
    const pasted = 'React 19, Next.js, design systems';
    const noAd = { ...window, content: null, contentStatus: 'empty' as const, fit: { ...fit, hadDescription: false } };
    const adField = () => screen.getByPlaceholderText<HTMLTextAreaElement>(AD_PLACEHOLDER);
    const linkField = () => screen.getByPlaceholderText<HTMLInputElement>(LINK_PLACEHOLDER);
    const paste = (text: string) => {
      fireEvent.paste(adField());
      fireEvent.change(adField(), { target: { value: text } });
    };

    it('one the board page doesn’t give, pasted: saved at once; done, the AI judges the job from it', async () => {
      saveAd.mockResolvedValue({ ok: true, data: { ...window, content: pasted, contentStatus: 'ok' } });
      assess.mockResolvedValue({ ok: true, data: { ...fit, score: 80 } });
      open({ shown: noAd });
      expect(screen.getByText(/The board page had no ad text\.\s*$/)).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: 'Paste the ad text' }));
      paste(`  ${pasted}\n`);
      await waitFor(() => expect(saveAd).toHaveBeenCalledExactlyOnceWith({ jobId: JOB, content: pasted }));
      expect(await screen.findByText(/saved/)).toBeTruthy();
      expect(assess).not.toHaveBeenCalled(); // not while you're editing
      fireEvent.click(screen.getByRole('button', { name: 'Done' }));
      expect(await screen.findByText(pasted)).toBeTruthy();
      await waitFor(() => expect(assess).toHaveBeenCalledExactlyOnceWith({ jobId: JOB }));
      expect(await screen.findByText('80%')).toBeTruthy();
      expect(saveAd).toHaveBeenCalledOnce();
    });

    it('typed: saved as you leave the box (or stop typing)', async () => {
      saveAd.mockResolvedValue({ ok: true, data: { ...window, content: 'something else' } });
      open();
      fireEvent.click(screen.getByRole('button', { name: 'Edit the ad' }));
      expect(adField().value).toBe(window.content);
      fireEvent.change(adField(), { target: { value: 'something else' } });
      expect(saveAd).not.toHaveBeenCalled();
      fireEvent.blur(adField());
      await waitFor(() => expect(saveAd).toHaveBeenCalledExactlyOnceWith({ jobId: JOB, content: 'something else' }));
    });

    it('done without a change: nothing saved, no AI call', async () => {
      open();
      fireEvent.click(screen.getByRole('button', { name: 'Edit the ad' }));
      fireEvent.click(screen.getByRole('button', { name: 'Done' }));
      expect(await screen.findByText(window.content ?? '')).toBeTruthy();
      expect(saveAd).not.toHaveBeenCalled();
      expect(assess).not.toHaveBeenCalled();
    });

    it('a link pasted: the ad is read from its page and saved, with what the board didn’t say', async () => {
      const link = 'https://careers.rossmann.pl/jobs/42';
      readAd.mockResolvedValue({
        ok: true,
        data: { ...window, content: pasted, contentStatus: 'ok', details: { contract: 'B2B', salary: '30 000 PLN' } },
      });
      open({ shown: noAd });
      fireEvent.click(screen.getByRole('button', { name: 'Paste the ad text' }));
      fireEvent.paste(linkField(), { clipboardData: { getData: () => ` ${link} ` } });
      await waitFor(() => expect(readAd).toHaveBeenCalledExactlyOnceWith({ jobId: JOB, link }));
      await waitFor(() => expect(adField().value).toBe(pasted));
      expect(screen.getByText('30 000 PLN')).toBeTruthy();
      expect(saveAd).not.toHaveBeenCalled(); // saved by the read
    });

    it('a page that can’t be read says why; what you typed stays', async () => {
      readAd.mockResolvedValue({ ok: false, error: 'That page has no ad text (a login wall?).' });
      open({ shown: noAd });
      fireEvent.click(screen.getByRole('button', { name: 'Paste the ad text' }));
      fireEvent.change(linkField(), { target: { value: 'https://linkedin.com/jobs/view/1' } });
      fireEvent.keyDown(linkField(), { key: 'Enter' });
      expect(await screen.findByText('That page has no ad text (a login wall?).')).toBeTruthy();
      expect(adField().value).toBe('');
    });

    it('closing the window saves what you typed (no AI call); "Mark applied" saves it first', async () => {
      saveAd.mockResolvedValue({ ok: true, data: { ...window, content: pasted } });
      open({ shown: noAd });
      fireEvent.click(screen.getByRole('button', { name: 'Paste the ad text' }));
      fireEvent.change(adField(), { target: { value: pasted } });
      fireEvent.click(screen.getAllByRole('button', { name: 'Close' })[0]);
      await waitFor(() => expect(saveAd).toHaveBeenCalledExactlyOnceWith({ jobId: JOB, content: pasted }));
      expect(assess).not.toHaveBeenCalled();
      cleanup();
      saveAd.mockClear();
      open({ shown: noAd });
      fireEvent.click(screen.getByRole('button', { name: 'Paste the ad text' }));
      fireEvent.change(adField(), { target: { value: pasted } });
      fireEvent.click(screen.getByRole('button', { name: 'Mark applied' }));
      await waitFor(() => expect(apply).toHaveBeenCalled());
      expect(saveAd).toHaveBeenCalledExactlyOnceWith({ jobId: JOB, content: pasted });
      expect(saveAd.mock.invocationCallOrder[0]).toBeLessThan(apply.mock.invocationCallOrder[0]);
    });

    it('an ad that can’t be saved stops "Mark applied"', async () => {
      saveAd.mockResolvedValue({ ok: false, error: 'That offer is no longer in the database.' });
      open({ shown: noAd });
      fireEvent.click(screen.getByRole('button', { name: 'Paste the ad text' }));
      fireEvent.change(adField(), { target: { value: pasted } });
      fireEvent.click(screen.getByRole('button', { name: 'Mark applied' }));
      expect(await screen.findByText('The ad wasn’t saved: That offer is no longer in the database.')).toBeTruthy();
      expect(apply).not.toHaveBeenCalled();
    });
  });

  it('Archive takes the offer out of the list', async () => {
    open({ inRow: true });
    fireEvent.click(screen.getByRole('button', { name: 'Archive' }));
    await waitFor(() => expect(archive).toHaveBeenCalledExactlyOnceWith({ jobId: JOB }));
  });
});
