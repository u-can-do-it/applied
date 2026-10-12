import 'server-only';
import { env } from '../env';

// Which AI the app asks: Gemini when GEMINI_API_KEY is set, else OpenAI. Gemini through its
// OpenAI-compatible API, so lib/ai/openai.ts asks both the same way (Chat Completions, a strict
// JSON schema, reasoning_effort).

export const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/openai';

/** The key variables, for "not set" messages. */
export const AI_KEYS = 'GEMINI_API_KEY or OPENAI_API_KEY';

export type AiProvider = { name: 'Gemini' | 'OpenAI'; key: string; baseUrl: string };

/** null: neither key is set (no AI filter, no AI runs, "Fill in" reads only what a page says plainly). */
export function aiProvider(): AiProvider | null {
  if (env.GEMINI_API_KEY) return { name: 'Gemini', key: env.GEMINI_API_KEY, baseUrl: GEMINI_BASE_URL };
  if (env.OPENAI_API_KEY) return { name: 'OpenAI', key: env.OPENAI_API_KEY, baseUrl: env.OPENAI_BASE_URL };
  return null;
}
