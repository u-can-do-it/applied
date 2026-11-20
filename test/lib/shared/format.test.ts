import { describe, expect, it } from 'vitest';
import { ago, duration } from '@/lib/shared/format';

describe('ago', () => {
  const now = Date.parse('2026-10-03T12:00:00Z');
  const before = (minutes: number) => new Date(now - minutes * 60_000).toISOString();

  it('says minutes, then hours up to 48, then days', () => {
    expect(ago(before(0), now)).toBe('just now');
    expect(ago(before(12), now)).toBe('12 min ago');
    expect(ago(before(5 * 60), now)).toBe('5 h ago');
    expect(ago(before(47 * 60), now)).toBe('47 h ago');
    expect(ago(before(48 * 60), now)).toBe('2 days ago');
    expect(ago(before(80 * 60), now)).toBe('3 days ago');
  });
});

describe('duration', () => {
  it('minutes, then hours up to 48, then days', () => {
    expect(duration(0)).toBe('0 min');
    expect(duration(12 * 60_000)).toBe('12 min');
    expect(duration(5 * 3600_000)).toBe('5 h');
    expect(duration(47 * 3600_000)).toBe('47 h');
    expect(duration(48 * 3600_000)).toBe('2 days');
    expect(duration(10.4 * 24 * 3600_000)).toBe('10 days');
  });
});
