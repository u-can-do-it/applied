import { describe, expect, it } from 'vitest';
import {
  columnsOf,
  contentOf,
  fetchDue,
  NO_AD_TEXT,
  NO_TEXT,
  NONE,
  transition,
  type AdContent,
  type ContentEvent,
  type ContentState,
} from '@/lib/ad-content-state';

const AT = '2026-10-03T10:00:00.000Z';
const EARLIER = '2026-09-01T08:00:00.000Z';
const FULL = 'A full ad. '.repeat(10).trim(); // 109 characters
const SHORT = 'Salary 20k, remote';

const saved = (extra: Partial<AdContent> = {}): AdContent => ({
  status: 'ok',
  text: FULL,
  error: null,
  scrapedAt: EARLIER,
  ...extra,
});

/** The next state, failing the test if the event changed nothing. */
const next = (state: ContentState, event: ContentEvent) => {
  const result = transition(state, event);
  expect(result.changed).toBe(true);
  return result.state;
};

describe('ad content: a new application', () => {
  it('"Mark applied": pending, fetched right away', () => {
    const result = transition(NONE, { type: 'marked' });
    expect(result).toEqual({ state: { status: 'pending', text: null, error: null, scrapedAt: null }, changed: true });
    expect(fetchDue(result)).toBe(true);
  });

  it('added with the full ad typed: ok, saved now', () => {
    const result = transition(NONE, { type: 'added', text: FULL, hasLink: true, at: AT });
    expect(result.state).toEqual({ status: 'ok', text: FULL, error: null, scrapedAt: AT });
    expect(fetchDue(result)).toBe(false);
  });

  it('added with a link and no text: pending, fetched', () => {
    const result = transition(NONE, { type: 'added', text: '', hasLink: true, at: AT });
    expect(result.state).toEqual({ status: 'pending', text: null, error: null, scrapedAt: null });
    expect(fetchDue(result)).toBe(true);
  });

  it('added with a link and less than a full ad: pending with it, fetched', () => {
    const result = transition(NONE, { type: 'added', text: SHORT, hasLink: true, at: AT });
    expect(result.state).toEqual({ status: 'pending', text: SHORT, error: null, scrapedAt: AT });
    expect(fetchDue(result)).toBe(true);
  });

  it('added without a link: empty, with or without a few words', () => {
    expect(next(NONE, { type: 'added', text: '', hasLink: false, at: AT })).toEqual({
      status: 'empty',
      text: null,
      error: NO_TEXT,
      scrapedAt: null,
    });
    const result = transition(NONE, { type: 'added', text: SHORT, hasLink: false, at: AT });
    expect(result.state).toEqual({ status: 'empty', text: SHORT, error: NO_TEXT, scrapedAt: AT });
    expect(fetchDue(result)).toBe(false);
  });

  it('only a new application can be added or marked', () => {
    expect(() => transition(saved(), { type: 'marked' })).toThrow(/"marked" can't happen in state "ok"/);
    expect(() => transition(saved(), { type: 'added', text: '', hasLink: false, at: AT })).toThrow();
  });
});

describe('ad content: "✎ Edit" (the six outcomes)', () => {
  const edit = (state: AdContent, text: string, hasLink: boolean) =>
    transition(state, { type: 'edited', text, hasLink, at: AT });

  it('1. text left empty, with a link: pending, fetched (the old text goes)', () => {
    const result = edit(saved(), '', true);
    expect(result).toEqual({
      state: { status: 'pending', text: null, error: null, scrapedAt: EARLIER },
      changed: true,
    });
    expect(fetchDue(result)).toBe(true);
    // also when it was pending already: the fetch is asked for again
    expect(fetchDue(edit(saved({ status: 'pending', text: null }), '', true))).toBe(true);
  });

  it('2. text emptied, no link: empty, "added by hand"', () => {
    const result = edit(saved(), '', false);
    expect(result.state).toEqual({ status: 'empty', text: null, error: NO_TEXT, scrapedAt: EARLIER });
    expect(fetchDue(result)).toBe(false);
  });

  it('3. no text before or after, no link: unchanged', () => {
    const before = saved({ status: 'failed', text: null, error: 'HTTP 404' });
    expect(edit(before, '', false)).toEqual({ state: before, changed: false });
    expect(edit(saved({ text: '   ' }), '', false).changed).toBe(false);
  });

  it('4. the same text: unchanged, whatever the state and the link', () => {
    for (const before of [
      saved(),
      saved({ status: 'pending', text: SHORT }),
      saved({ status: 'empty', text: ` ${SHORT} ` }),
    ]) {
      for (const hasLink of [true, false]) {
        const result = edit(before, (before.text ?? '').trim(), hasLink);
        expect(result).toEqual({ state: before, changed: false });
        expect(fetchDue(result)).toBe(false);
      }
    }
  });

  it('5. a new full ad typed: ok, saved now', () => {
    const before = saved({ status: 'failed', text: null, error: 'HTTP 404' });
    const other = `${FULL} More.`;
    expect(edit(before, other, true).state).toEqual({ status: 'ok', text: other, error: null, scrapedAt: AT });
    expect(edit(saved(), other, false).state).toEqual({ status: 'ok', text: other, error: null, scrapedAt: AT });
  });

  it('6. less than a full ad, new: pending and fetched with a link, else empty', () => {
    const withLink = edit(saved(), SHORT, true);
    expect(withLink.state).toEqual({ status: 'pending', text: SHORT, error: null, scrapedAt: EARLIER });
    expect(fetchDue(withLink)).toBe(true);
    const without = edit(saved(), SHORT, false);
    expect(without.state).toEqual({ status: 'empty', text: SHORT, error: NO_TEXT, scrapedAt: EARLIER });
    expect(fetchDue(without)).toBe(false);
  });

  it('an application that is not there cannot be edited', () => {
    expect(() => transition(NONE, { type: 'edited', text: '', hasLink: true, at: AT })).toThrow();
  });
});

describe('ad content: the fetch (saveContent)', () => {
  const waiting = saved({ status: 'pending', text: null });
  const typedShort = saved({ status: 'pending', text: SHORT });
  const states: AdContent[] = [
    waiting,
    typedShort,
    saved(),
    saved({ status: 'empty', text: null, error: NO_TEXT }),
    saved({ status: 'failed', text: null, error: 'HTTP 500' }),
  ];

  it('succeeded: ok, from any state ("↻ Try again" too)', () => {
    for (const before of states)
      expect(next(before, { type: 'fetchSucceeded', text: FULL, at: AT })).toEqual({
        status: 'ok',
        text: FULL,
        error: null,
        scrapedAt: AT,
      });
  });

  it('the page had no ad text: empty, keeping what you typed', () => {
    expect(next(waiting, { type: 'fetchFoundNoText', at: AT })).toEqual({
      status: 'empty',
      text: null,
      error: NO_AD_TEXT,
      scrapedAt: AT,
    });
    expect(next(typedShort, { type: 'fetchFoundNoText', at: AT })).toEqual({
      status: 'empty',
      text: SHORT,
      error: NO_AD_TEXT,
      scrapedAt: AT,
    });
  });

  it('failed: failed, with the reason, keeping what you typed (also on "↻ Try again")', () => {
    expect(next(waiting, { type: 'fetchFailed', error: 'HTTP 403', at: AT })).toEqual({
      status: 'failed',
      text: null,
      error: 'HTTP 403',
      scrapedAt: AT,
    });
    const failed = next(typedShort, { type: 'fetchFailed', error: 'HTTP 403', at: AT });
    expect(failed).toEqual({ status: 'failed', text: SHORT, error: 'HTTP 403', scrapedAt: AT });
    expect(next(failed, { type: 'fetchFailed', error: 'HTTP 500', at: AT })).toMatchObject({ text: SHORT });
    expect(fetchDue(transition(waiting, { type: 'fetchFailed', error: null, at: AT }))).toBe(false);
  });

  it('an ok text may be a fetched ad: a fetch without one replaces it, as before', () => {
    expect(next(saved(), { type: 'fetchFailed', error: 'HTTP 403', at: AT })).toMatchObject({ text: null });
    expect(next(saved(), { type: 'fetchFoundNoText', at: AT })).toMatchObject({ text: null });
  });

  it('nothing is fetched for an application that is not there', () => {
    expect(() => transition(NONE, { type: 'fetchSucceeded', text: FULL, at: AT })).toThrow();
    expect(() => transition(NONE, { type: 'fetchFoundNoText', at: AT })).toThrow();
    expect(() => transition(NONE, { type: 'fetchFailed', error: null, at: AT })).toThrow();
  });
});

describe('ad content: the row', () => {
  it('reads and writes the four columns', () => {
    const row = { content: FULL, contentStatus: 'ok' as const, contentError: null, scrapedAt: EARLIER };
    expect(contentOf(row)).toEqual(saved());
    expect(columnsOf(contentOf(row))).toEqual(row);
    expect(() => columnsOf(NONE)).toThrow();
  });
});
