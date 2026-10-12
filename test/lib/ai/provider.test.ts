import { afterEach, describe, expect, it, vi } from 'vitest';
import { aiConfig, extractJob } from '@/lib/ai/openai';
import { aiProvider, GEMINI_BASE_URL } from '@/lib/ai/provider';

// Which AI is asked, with which model, and how: Gemini when its key is set, else OpenAI.

const keys = (gemini: string, openai: string) => {
  vi.stubEnv('GEMINI_API_KEY', gemini);
  vi.stubEnv('OPENAI_API_KEY', openai);
};

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('aiProvider', () => {
  it('is Gemini when its key is set, even with an OpenAI key', () => {
    keys('gemini-key', 'sk-openai');
    expect(aiProvider()).toEqual({ name: 'Gemini', key: 'gemini-key', baseUrl: GEMINI_BASE_URL });
  });

  it('is OpenAI, at OPENAI_BASE_URL, with only its key', () => {
    keys('', 'sk-openai');
    vi.stubEnv('OPENAI_BASE_URL', 'https://proxy.example.com/v1');
    expect(aiProvider()).toEqual({ name: 'OpenAI', key: 'sk-openai', baseUrl: 'https://proxy.example.com/v1' });
  });

  it('is null without either key', () => {
    keys('', '');
    expect(aiProvider()).toBeNull();
  });
});

describe('aiConfig', () => {
  it('Gemini: GEMINI_MODEL for every job (the per-job models are OpenAI’s)', () => {
    keys('gemini-key', '');
    vi.stubEnv('OPENAI_ASSESS_MODEL', 'gpt-x');
    vi.stubEnv('OPENAI_DEDUP_EFFORT', 'medium');
    expect(aiConfig()).toEqual({
      assess: { model: 'gemini-3.8-flash', effort: 'medium' },
      dedup: { model: 'gemini-3.8-flash', effort: 'medium' },
      extract: { model: 'gemini-3.8-flash', effort: 'low' },
    });
  });

  it('OpenAI: a job’s own model, else OPENAI_MODEL', () => {
    keys('', 'sk-openai');
    vi.stubEnv('OPENAI_ASSESS_MODEL', 'gpt-x');
    expect(aiConfig().assess.model).toBe('gpt-x');
    expect(aiConfig().dedup.model).toBe('gpt-6-luna');
  });
});

describe('asking Gemini', () => {
  it('sends the request to its OpenAI-compatible API, with its key, model and effort', async () => {
    keys('gemini-key', 'sk-openai');
    const fetch = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(() =>
      Promise.resolve(Response.json({ choices: [{ message: { content: '{"title":"Dev"}' } }] })),
    );
    vi.stubGlobal('fetch', fetch);

    expect(await extractJob({ url: 'https://example.com/job', pageTitle: 'Dev', text: 'An ad' })).toEqual({
      title: 'Dev',
    });

    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe(`${GEMINI_BASE_URL}/chat/completions`);
    expect(new Headers(init.headers).get('Authorization')).toBe('Bearer gemini-key');
    expect(JSON.parse(init.body as string)).toMatchObject({ model: 'gemini-3.8-flash', reasoning_effort: 'low' });
  });

  it('names Gemini in its errors', async () => {
    keys('gemini-key', '');
    vi.stubGlobal('fetch', () => Promise.resolve(new Response('overloaded', { status: 503 })));
    await expect(extractJob({ url: '', pageTitle: '', text: 'An ad' })).rejects.toThrow('Gemini 503: overloaded');
  });

  it('without a key, says which to set', async () => {
    keys('', '');
    await expect(extractJob({ url: '', pageTitle: '', text: 'An ad' })).rejects.toThrow(
      'No AI key: GEMINI_API_KEY or OPENAI_API_KEY is not set',
    );
  });
});
