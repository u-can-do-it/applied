import { redirect } from 'next/navigation';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { action, formAction } from '@/server/action';
import { requireLogin } from '@/server/session';

vi.mock('@/server/session', () => ({ requireLogin: vi.fn() }));
const login = vi.mocked(requireLogin);

const schema = z.object({ name: z.string().min(1, 'Give it a name.'), count: z.number().default(1) });

describe('action', () => {
  beforeEach(() => {
    login.mockReset();
    login.mockResolvedValue(undefined);
  });

  it('answers with what the function returns', async () => {
    const greet = action(schema, ({ name, count }) => Promise.resolve(`${name} ×${count}`));
    expect(await greet({ name: 'Ada' })).toEqual({ ok: true, data: 'Ada ×1' });
    expect(login).toHaveBeenCalledOnce();
  });

  it('fails without a login, before looking at the input', async () => {
    login.mockRejectedValue(new Error('Not logged in'));
    const fn = vi.fn(() => Promise.resolve('never'));
    const greet = action(schema, fn);
    expect(await greet({ name: '' })).toEqual({ ok: false, error: 'Not logged in' });
    expect(fn).not.toHaveBeenCalled();
  });

  it('fails with the schema’s message, or "Bad request." for a request the forms never send', async () => {
    const fn = vi.fn(() => Promise.resolve('never'));
    const greet = action(schema, fn);
    expect(await greet({ name: '' })).toEqual({ ok: false, error: 'Give it a name.' });
    expect(await greet({ name: 'Ada', count: 'two' } as unknown as { name: string })).toEqual({
      ok: false,
      error: 'Bad request.',
    });
    expect(await greet(undefined as unknown as { name: string })).toEqual({ ok: false, error: 'Bad request.' });
    expect(fn).not.toHaveBeenCalled();
  });

  it('turns a thrown error into a failure with its message', async () => {
    const broken = action(schema, () => Promise.reject(new Error('The database is down.')));
    expect(await broken({ name: 'Ada' })).toEqual({ ok: false, error: 'The database is down.' });
    // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- what a library might do
    const weird = action(schema, () => Promise.reject('just a string'));
    expect(await weird({ name: 'Ada' })).toEqual({ ok: false, error: 'just a string' });
  });

  it('lets redirect() through: it is how Next.js answers, not a failure', async () => {
    const go = action(schema, () => redirect('/elsewhere'));
    await expect(go({ name: 'Ada' })).rejects.toThrow('NEXT_REDIRECT');
  });

  it('skips the login check for a public action', async () => {
    login.mockRejectedValue(new Error('Not logged in'));
    const open = action(schema, ({ name }) => Promise.resolve(name), { public: true });
    expect(await open({ name: 'Ada' })).toEqual({ ok: true, data: 'Ada' });
    expect(login).not.toHaveBeenCalled();
  });
});

describe('formAction', () => {
  beforeEach(() => {
    login.mockReset();
    login.mockResolvedValue(undefined);
  });

  it('reads the fields of the FormData, whatever the previous answer was', async () => {
    const form = new FormData();
    form.set('name', 'Ada');
    form.set('$ACTION_ID_abc', ''); // what React adds; the schema drops unknown keys
    const save = formAction(z.object({ name: z.string() }), (input) => Promise.resolve(input));
    expect(await save(null, form)).toEqual({ ok: true, data: { name: 'Ada' } });
    expect(await save({ ok: false, error: 'before' }, form)).toEqual({ ok: true, data: { name: 'Ada' } });
  });

  it('reads nothing before the login check, and anything but FormData is a bad request', async () => {
    login.mockRejectedValue(new Error('Not logged in'));
    const form = new FormData();
    const read = vi.fn(() => [][Symbol.iterator]());
    Object.defineProperty(form, Symbol.iterator, { value: read }); // what Object.fromEntries() calls
    const save = formAction(z.object({}), () => Promise.resolve('never'));
    expect(await save(null, form)).toEqual({ ok: false, error: 'Not logged in' });
    expect(read).not.toHaveBeenCalled();
    login.mockResolvedValue(undefined);
    expect(await save(null, form)).toEqual({ ok: true, data: 'never' });
    expect(read).toHaveBeenCalledOnce();
    expect(await save(null, { name: 'Ada' } as unknown as FormData)).toEqual({ ok: false, error: 'Bad request.' });
  });

  it('fails like action() does', async () => {
    const save = formAction(schema, () => Promise.resolve('never'));
    expect(await save(null, new FormData())).toEqual({ ok: false, error: 'Bad request.' });
    login.mockRejectedValue(new Error('Not logged in'));
    expect(await save(null, new FormData())).toEqual({ ok: false, error: 'Not logged in' });
  });
});
