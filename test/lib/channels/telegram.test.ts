import { beforeEach, describe, expect, it, vi } from 'vitest';
import { telegramChannel } from '@/lib/channels/telegram';
import * as settingsRepo from '@/lib/db/repos/scrape-settings';
import { DEFAULT_SETTINGS } from '@/lib/listings/settings';
import { telegramReady } from '@/lib/telegram';

// The Telegram channel is ready only when it's set up and "Send to Telegram" is on: switched off, the
// run sends it nothing (and queues only for another ready channel).

vi.mock('@/lib/telegram', () => ({ telegramReady: vi.fn(), formatNotification: vi.fn(), sendMessage: vi.fn() }));
vi.mock('@/lib/db/repos/scrape-settings', () => ({ get: vi.fn() }));
const configured = vi.mocked(telegramReady);
const settings = vi.mocked(settingsRepo.get);

describe('telegramChannel.ready', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    configured.mockReturnValue(true);
    settings.mockResolvedValue({ ...DEFAULT_SETTINGS });
  });

  it('is ready when set up and switched on', async () => {
    expect(await telegramChannel.ready()).toBe(true);
  });

  it('is not ready when switched off in Settings', async () => {
    settings.mockResolvedValue({ ...DEFAULT_SETTINGS, telegramEnabled: false });
    expect(await telegramChannel.ready()).toBe(false);
  });

  it('is not ready without the bot token and chat id (and doesn’t read the settings)', async () => {
    configured.mockReturnValue(false);
    expect(await telegramChannel.ready()).toBe(false);
    expect(settings).not.toHaveBeenCalled();
  });
});
