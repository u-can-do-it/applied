import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from '@/app/api/telegram/route';
import * as settingsRepo from '@/lib/db/repos/scrape-settings';
import * as stateRepo from '@/lib/db/repos/scrape-state';
import { notify } from '@/lib/listings/pipeline/notify';
import { runAll } from '@/lib/listings/run';
import { DEFAULT_SETTINGS } from '@/lib/listings/settings';
import { sendMessage } from '@/lib/telegram';

// The bot's webhook: only with Telegram's secret, only from your chat, and only while "Send to Telegram"
// is on. Off, a command is still answered 200 (Telegram would retry anything else), but nothing runs
// and the chat gets no reply.

const afterAnswer: (() => unknown)[] = [];
vi.mock('next/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/server')>()),
  after: (task: () => unknown) => {
    afterAnswer.push(task);
  },
}));
vi.mock('@/lib/telegram', () => ({
  telegramReady: () => true,
  webhookSecret: () => Promise.resolve('secret'),
  ownerChat: () => '42',
  sendMessage: vi.fn(() => Promise.resolve()),
}));
vi.mock('@/lib/db/repos/scrape-settings', () => ({ get: vi.fn() }));
vi.mock('@/lib/db/repos/scrape-state', () => ({
  get: vi.fn(() => Promise.resolve({ muted: false })),
  setMuted: vi.fn(),
}));
vi.mock('@/lib/db/repos/notify-queue', () => ({ size: vi.fn(() => Promise.resolve(3)) }));
vi.mock('@/lib/db/repos/offers', () => ({ countPerBoard: vi.fn() }));
vi.mock('@/lib/db/repos/scrape-runs', () => ({ list: vi.fn() }));
vi.mock('@/lib/ai/profiles', () => ({ listProfiles: vi.fn() }));
vi.mock('@/lib/listings/pipeline/notify', () => ({ notify: vi.fn(() => Promise.resolve({})) }));
vi.mock('@/lib/listings/run', () => ({ runAll: vi.fn() }));

const settings = vi.mocked(settingsRepo.get);
const reply = vi.mocked(sendMessage);

const command = (text: string, { chat = 42, secret = 'secret' } = {}) =>
  POST(
    new NextRequest('https://jobwatch.test/api/telegram', {
      method: 'POST',
      headers: { 'x-telegram-bot-api-secret-token': secret, 'content-type': 'application/json' },
      body: JSON.stringify({ message: { chat: { id: chat }, text } }),
    }),
  );

describe('POST /api/telegram', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    afterAnswer.length = 0;
    settings.mockResolvedValue({ ...DEFAULT_SETTINGS });
  });

  it('runs a command from your chat and answers it', async () => {
    const response = await command('/mute');
    expect(response.status).toBe(200);
    expect(stateRepo.setMuted).toHaveBeenCalledWith(true);
    expect(reply).toHaveBeenCalledWith(expect.stringContaining('Muted'), '42');
  });

  it('refuses without the secret, and ignores another chat', async () => {
    expect((await command('/mute', { secret: 'wrong' })).status).toBe(401);
    expect(settings).not.toHaveBeenCalled();
    expect((await command('/mute', { chat: 7 })).status).toBe(200);
    expect(stateRepo.setMuted).not.toHaveBeenCalled();
    expect(reply).not.toHaveBeenCalled();
  });

  it.each(['/mute', '/resume', '/send', '/scrape', '/status', '/nonsense'])(
    'switched off: acknowledges %s with 200, runs nothing and says nothing',
    async (text) => {
      settings.mockResolvedValue({ ...DEFAULT_SETTINGS, telegramEnabled: false });
      const response = await command(text);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ ok: true });
      expect(afterAnswer).toEqual([]);
      expect(reply).not.toHaveBeenCalled();
      expect(stateRepo.setMuted).not.toHaveBeenCalled();
      expect(notify).not.toHaveBeenCalled();
      expect(runAll).not.toHaveBeenCalled();
    },
  );
});
