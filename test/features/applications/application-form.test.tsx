// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApplicationForm, type FormProps } from '@/features/applications/application-form';
import {
  addApplicationAction,
  fillFromLinkAction,
  fillFromTextAction,
  updateApplicationAction,
  type JobDraft,
} from '@/features/applications/actions';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import type { ApplicationWithContent } from '@/lib/applications';
import { zoneOf, DEFAULT_TZ } from '@/lib/dates';

vi.mock('@/features/applications/actions', () => ({
  addApplicationAction: vi.fn(),
  fillFromLinkAction: vi.fn(),
  fillFromTextAction: vi.fn(),
  updateApplicationAction: vi.fn(),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn() } }));
const add = vi.mocked(addApplicationAction);
const fillFromLink = vi.mocked(fillFromLinkAction);
const fillFromText = vi.mocked(fillFromTextAction);
const update = vi.mocked(updateApplicationAction);

const LINK = 'https://justjoin.it/job-offer/acme-react-dev';
const page: JobDraft = {
  url: LINK,
  board: 'justjoin',
  title: 'React Developer',
  company: 'Acme',
  location: 'Warszawa',
  workMode: 'remote',
  officeDays: '',
  salary: '20k',
  contract: 'B2B',
  content: 'The ad text',
  known: null,
  knownJobId: null,
};

const onSaved = vi.fn();
function open(props: Partial<FormProps> = {}) {
  render(
    <Sheet open>
      <SheetContent>
        <ApplicationForm onCancel={() => {}} onSaved={onSaved} {...(props as object)} />
      </SheetContent>
    </Sheet>,
  );
}
const box = (label: string) => screen.getByLabelText<HTMLInputElement>(label);
const type = (label: string, text: string) => fireEvent.change(box(label), { target: { value: text } });
const click = (name: string) => fireEvent.click(screen.getByRole('button', { name }));

// Radix's checkbox measures itself; jsdom has no ResizeObserver
class NoResize {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal('ResizeObserver', NoResize);

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

describe('ApplicationForm', () => {
  it('"Fill in from the link" leaves what you typed, and fills the rest', async () => {
    open();
    type('Title *', 'My own title');
    type('Link to the offer', LINK);
    expect(box('Board').value).toBe('justjoin'); // follows the link
    fillFromLink.mockResolvedValue({ ok: true, data: page });
    click('Fill in from the link');
    await waitFor(() => expect(box('Company').value).toBe('Acme'));
    expect(fillFromLink).toHaveBeenCalledWith({ link: LINK });
    expect(box('Title *').value).toBe('My own title');
    expect(box('Salary').value).toBe('20k');
    expect(box('Ad text').value).toBe('The ad text');
    expect(box('Work mode').value).toBe('remote');
    expect(screen.queryByLabelText('Office / home days')).toBeNull(); // a hybrid job's

    // filled in, not typed: another page fills it again
    fillFromLink.mockResolvedValue({ ok: true, data: { ...page, company: 'Globex', title: 'Other' } });
    fireEvent.click(await screen.findByRole('button', { name: 'Fill in from the link' }));
    await waitFor(() => expect(box('Company').value).toBe('Globex'));
    expect(box('Title *').value).toBe('My own title');
  });

  it('"Fill in from the ad text" reads what you pasted, which stays as it is', async () => {
    open();
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Fill in from the ad text' }).disabled).toBe(true);
    type('Title *', 'My own title');
    type('Link to the offer', LINK);
    type('Ad text', 'The pasted ad');
    fillFromText.mockResolvedValue({ ok: true, data: { ...page, url: '', board: '', content: '' } });
    click('Fill in from the ad text');
    await waitFor(() => expect(box('Company').value).toBe('Acme'));
    expect(fillFromText).toHaveBeenCalledWith({ text: 'The pasted ad', link: LINK });
    expect(fillFromLink).not.toHaveBeenCalled();
    expect(box('Title *').value).toBe('My own title');
    expect(box('Salary').value).toBe('20k');
    expect(box('Ad text').value).toBe('The pasted ad');
    expect(box('Link to the offer').value).toBe(LINK);
    expect(box('Board').value).toBe('justjoin');
  });

  it('editing, "Fill in" fills only the empty fields', async () => {
    const app = {
      jobId: 'acme|reactdev',
      url: LINK,
      title: 'Saved title',
      company: '',
      src: 'justjoin',
      appliedAt: '2026-10-01T10:00:00.000Z',
      stage: 'submitted',
      outcome: 'pending',
      details: { salary: '15k' },
      content: '',
    } as unknown as ApplicationWithContent;
    open({ app });
    fillFromLink.mockResolvedValue({ ok: true, data: page });
    click('Fill in from the link');
    await waitFor(() => expect(box('Company').value).toBe('Acme'));
    expect(box('Title *').value).toBe('Saved title');
    expect(box('Salary').value).toBe('15k');
    expect(box('Location').value).toBe('Warszawa');
  });

  it('says what is wrong under each field, with the schema’s words, and sends nothing', async () => {
    open();
    type('Link to the offer', 'jobs.example.com');
    type('Board', 'No Board!');
    click('Save');
    const title = box('Title *');
    await waitFor(() => expect(title.getAttribute('aria-invalid')).toBe('true'));
    const errorOf = (input: HTMLElement) =>
      document.getElementById(input.getAttribute('aria-describedby') ?? '')?.textContent;
    expect(errorOf(title)).toBe('The title is needed.');
    expect(errorOf(box('Link to the offer'))).toBe('The link must start with https://');
    expect(errorOf(box('Board'))).toBe('Board: lowercase letters, digits, - or _ (e.g. "linkedin").');
    expect(box('Company').getAttribute('aria-invalid')).toBeNull();
    expect(add).not.toHaveBeenCalled();

    // after the first Save, each change is checked again
    type('Title *', 'React Developer');
    await waitFor(() => expect(title.getAttribute('aria-invalid')).toBeNull());
  });

  it('Save sends the form’s values to the action; what the server says is wrong shows by the button', async () => {
    open();
    type('Title *', 'React Developer');
    type('Company', 'Acme');
    add.mockResolvedValueOnce({ ok: false, error: 'Pick the day you applied (not in the future).' });
    click('Save');
    expect(await screen.findByText('Pick the day you applied (not in the future).')).toBeTruthy();
    expect(add).toHaveBeenCalledWith({
      url: '',
      title: 'React Developer',
      company: 'Acme',
      board: 'unknown',
      day: zoneOf(DEFAULT_TZ).day(),
      stage: 'submitted',
      outcome: 'pending',
      salary: '',
      contract: '',
      location: '',
      workMode: '',
      officeDays: '',
      content: '',
      note: '',
    });
    expect(onSaved).not.toHaveBeenCalled();

    add.mockResolvedValueOnce({ ok: true, data: { jobId: 'acme|reactdeveloper' } });
    fireEvent.click(await screen.findByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(screen.queryByText('Pick the day you applied (not in the future).')).toBeNull();
    expect(update).not.toHaveBeenCalled();
  });

  it('Enter in the link reads the page; in another box it doesn’t save; in the day it commits the day', async () => {
    open();
    type('Title *', 'React Developer');
    expect(fireEvent.keyDown(box('Title *'), { key: 'Enter' })).toBe(false);
    const day = screen.getByLabelText<HTMLInputElement>('Applied on (dd.mm.yyyy)');
    fireEvent.change(day, { target: { value: '01.10.2026' } });
    expect(fireEvent.keyDown(day, { key: 'Enter' })).toBe(false);
    type('Link to the offer', LINK);
    fillFromLink.mockResolvedValue({ ok: true, data: page });
    expect(fireEvent.keyDown(box('Link to the offer'), { key: 'Enter' })).toBe(false);
    await waitFor(() => expect(box('Company').value).toBe('Acme'));
    expect(fillFromLink).toHaveBeenCalledWith({ link: LINK });
    expect(add).not.toHaveBeenCalled();

    add.mockResolvedValueOnce({ ok: true, data: { jobId: 'acme|reactdeveloper' } });
    fireEvent.click(await screen.findByRole('button', { name: 'Save' }));
    await waitFor(() => expect(add).toHaveBeenCalledWith(expect.objectContaining({ day: '2026-10-01' })));
  });
});
