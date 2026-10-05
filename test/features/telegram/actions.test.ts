import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as settingsRepo from '@/lib/db/repos/scrape-settings';
import { DEFAULT_SETTINGS } from '@/lib/listings/settings';
import { sendMessage } from '@/lib/telegram';
import { setTelegramEnabledAction, telegramTestAction } from '@/features/telegram/actions';

// The Telegram panel's switch: it changes only its own field, and while it's off the test message
// isn't sent (the button is disabled too, but the action doesn't rely on that).

vi.mock('@/server/session', () => ({ requireLogin: vi.fn(() => Promise.resolve()) }));
vi.mock('next/cache', () => ({ refresh: vi.fn() }));
vi.mock('next/headers', () => ({ headers: () => Promise.resolve(new Headers()) }));
vi.mock('@/lib/db/repos/scrape-settings', () => ({ get: vi.fn(), save: vi.fn() }));
vi.mock('@/lib/listings/schedule', () => ({ requestOrigin: vi.fn() }));
vi.mock('@/lib/telegram', () => ({ sendMessage: vi.fn(), connectWebhook: vi.fn(), disconnectWebhook: vi.fn() }));

const get = vi.mocked(settingsRepo.get);
const save = vi.mocked(settingsRepo.save);
const custom = { ...DEFAULT_SETTINGS, keywords: ['Vue'], notify: false, aiFilter: false, timeZone: 'Europe/Warsaw' };

beforeEach(() => {
  vi.clearAllMocks();
  get.mockResolvedValue({ ...custom });
});

describe('setTelegramEnabledAction', () => {
  it('saves the switch and keeps every other setting', async () => {
    expect(await setTelegramEnabledAction({ on: false })).toMatchObject({ ok: true });
    expect(save).toHaveBeenCalledExactlyOnceWith({ ...custom, telegramEnabled: false });
  });

  it('refuses anything but a boolean', async () => {
    expect(await setTelegramEnabledAction({ on: 'no' } as never)).toMatchObject({ ok: false });
    expect(save).not.toHaveBeenCalled();
  });
});

describe('telegramTestAction', () => {
  it('sends the test message while Telegram is on', async () => {
    expect(await telegramTestAction()).toEqual({ ok: true, data: 'Sent – check Telegram.' });
    expect(sendMessage).toHaveBeenCalledOnce();
  });

  it('refuses while Telegram is switched off, without sending', async () => {
    get.mockResolvedValue({ ...custom, telegramEnabled: false });
    expect(await telegramTestAction()).toEqual({
      ok: false,
      error: 'Telegram is switched off: turn on “Send to Telegram” first.',
    });
    expect(sendMessage).not.toHaveBeenCalled();
  });
});
