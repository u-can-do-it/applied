# 10. Gemini through its OpenAI-compatible API, OpenAI kept as the fallback

- Status: accepted (2026-10-12)
- Context: [`lib/ai/provider.ts`](../../lib/ai/provider.ts), [`lib/ai/openai.ts`](../../lib/ai/openai.ts),
  [`lib/budgets.ts`](../../lib/budgets.ts); [OPERATIONS.md → AI](../OPERATIONS.md#ai-gemini-openai)

## Context

The AI jobs (assessing offers against a profile, deciding duplicates, reading an ad into the "Add application"
form) move from OpenAI (`gpt-6-luna`) to Gemini 3.8 Flash. The client is plain `fetch` to Chat Completions with
a strict JSON schema and `reasoning_effort`; Gemini's OpenAI-compatible endpoint takes that request unchanged.

Before switching, the app's own prompts were run on Gemini against `gpt-6-luna`'s stored answers (read-only:
76 verdicts, 29 duplicate pairs, 6 extractions):

- **Assessment:** Gemini follows the profile's criteria more literally. It rejects offers where React is
  secondary or the office isn't in Warsaw, which `gpt-6-luna` let through, and no longer rejects on a skill gap
  (years, English level), which the prompt says belongs in the score. Fewer matches: 19 to 23 of 40 on a sample
  weighted to borderline offers. Its body leasing calls held up.
- **Duplicates:** 23–25 of 29 the same, the differences defensible either way; the same answers at every effort.
- **Extraction:** as good, at low effort.
- **Latency:** at high effort an assessment batch (4 offers) took 24–96 s and 2 of 12 calls outlasted 150 s; at
  medium 6–68 s, with the same match verdicts as high within run-to-run noise.

## Decision

- **One client, two providers.** `GEMINI_API_KEY` set: Gemini, at
  `generativelanguage.googleapis.com/v1beta/openai`; else `OPENAI_API_KEY`: OpenAI, at `OPENAI_BASE_URL`. The
  prompts, schemas, the retry without `reasoning_effort` and the errors (naming the provider) are shared.
- **One Gemini model**, `GEMINI_MODEL` (default `gemini-3.8-flash`); the per-job `OPENAI_*_MODEL` stay OpenAI's.
  The efforts (`OPENAI_*_EFFORT`) apply to both: renamed, the deployed settings would silently fall back to the
  defaults.
- **Assessment at medium effort** by default (was high).
- **`AI_TIMEOUT_MS` 150 s** (was 120 s), for the slow tail. The budgets derived from it within the 300 s function
  shrink: a scrape's AI window and an AI run's slice to 120 s, the keyword ad check to 45 s.

## Consequences

- Back to OpenAI: unset `GEMINI_API_KEY`.
- The `OPENAI_` prefix of the effort variables and the file name `openai.ts` cover Gemini too.
- Gemini's native API (thinking budgets, explicit context caching) isn't used.
