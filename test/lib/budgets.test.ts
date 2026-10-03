import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AD_TIMEOUT_MS,
  AI_BUDGET_MS,
  AI_RUN_LOCK_MS,
  FUNCTION_LIMIT_MS,
  OPENAI_TIMEOUT_MS,
  SCRAPE_LOCK_MS,
  SCRAPE_LOCK_SECONDS,
  SLICE_MS,
  WRAP_UP_MS,
} from '@/lib/budgets';
import { INTERVALS } from '@/lib/listings/settings';

// The relationships the budgets must keep, whatever a later change does to one of them.

const root = join(import.meta.dirname, '../..');
const app = join(root, 'app');
const MAX_DURATION = /export\s+const\s+maxDuration\b[^=]*=\s*([^;\n]+)/g;

describe('time budgets', () => {
  it("a scrape run's last AI batch and the wrap-up fit in the function", () => {
    expect(AI_BUDGET_MS).toBeGreaterThan(0);
    expect(AI_BUDGET_MS + OPENAI_TIMEOUT_MS + WRAP_UP_MS).toBeLessThanOrEqual(FUNCTION_LIMIT_MS);
  });

  it("an AI run's slice and its last round fit in the function", () => {
    expect(SLICE_MS).toBeGreaterThan(0);
    expect(SLICE_MS + OPENAI_TIMEOUT_MS + WRAP_UP_MS).toBeLessThanOrEqual(FUNCTION_LIMIT_MS);
  });

  it('the scrape lock outlives a live run, and a crashed run frees it by the next knock', () => {
    expect(SCRAPE_LOCK_MS).toBeGreaterThanOrEqual(AI_BUDGET_MS + OPENAI_TIMEOUT_MS);
    expect(SCRAPE_LOCK_MS).toBeLessThan(Math.min(...INTERVALS) * 60_000);
    // the scrape lock (lib/db/repos/scrape-state.ts lock) takes whole seconds (::int)
    expect(Number.isInteger(SCRAPE_LOCK_SECONDS)).toBe(true);
  });

  it("an AI run's lock outlasts each part of a round", () => {
    // renewed right before the OpenAI call: the call, then saving the round (which renews it again)
    expect(AI_RUN_LOCK_MS).toBeGreaterThan(OPENAI_TIMEOUT_MS + 10_000);
    // from the last renewal: a batch's ads, a few jobs at once, each job's boards one after another
    expect(AI_RUN_LOCK_MS).toBeGreaterThanOrEqual(5 * AD_TIMEOUT_MS);
  });

  it('every maxDuration is the function limit, as a literal (Next reads it without running the code)', () => {
    const files = readdirSync(app, { recursive: true, encoding: 'utf8' }).filter((file) => /\.tsx?$/.test(file));
    const mentioning = files.filter((file) => readFileSync(join(app, file), 'utf8').includes('maxDuration'));
    // the routes that scrape or call OpenAI ("Scrape now" is one), and the pages whose server actions
    // or after() do (AI runs, reading an ad, "+ Add application", testing a scraper)
    expect(mentioning.length).toBeGreaterThanOrEqual(7);
    expect(mentioning).toEqual(
      expect.arrayContaining([join('api', 'scrape', 'route.ts'), join('api', 'cron', 'scrape', 'route.ts')]),
    );
    for (const file of mentioning) {
      const declared = [...readFileSync(join(app, file), 'utf8').matchAll(MAX_DURATION)].map((match) =>
        match[1].trim(),
      );
      expect(declared, file).not.toEqual([]);
      for (const value of declared) expect(value, file).toBe(String(FUNCTION_LIMIT_MS / 1000));
    }
  });

  it('no maxDuration outside app/ (Next reads it only from a page, layout or route file)', () => {
    for (const dir of ['features', 'components', 'server', 'lib']) {
      const files = readdirSync(join(root, dir), { recursive: true, encoding: 'utf8' }).filter((file) =>
        /\.tsx?$/.test(file),
      );
      for (const file of files)
        expect(readFileSync(join(root, dir, file), 'utf8'), join(dir, file)).not.toMatch(MAX_DURATION);
    }
  });
});
