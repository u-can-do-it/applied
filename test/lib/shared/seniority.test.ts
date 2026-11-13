import { describe, expect, it } from 'vitest';
import { LEVEL_OPTIONS, levelOf, NO_LEVEL, parseLevels, toggleLevel, wordsOf } from '@/lib/shared/seniority';

describe('levelOf', () => {
  it("groups the boards' words into the levels, whatever their case or spaces", () => {
    expect(levelOf('senior')).toBe('senior');
    expect(levelOf(' Senior ')).toBe('senior');
    expect(levelOf('expert')).toBe('senior'); // Pracuj's and NoFluff's step above senior
    expect(levelOf('regular')).toBe('mid');
    expect(levelOf('medium')).toBe('mid'); // Bulldog
    expect(levelOf('intern')).toBe('junior');
    expect(levelOf('trainee')).toBe('junior');
    expect(levelOf('manager')).toBe('lead');
    expect(levelOf('c_level')).toBe('lead');
  });

  it('takes none given, or one it does not know, as no level', () => {
    expect(levelOf(null)).toBe(NO_LEVEL.level);
    expect(levelOf('')).toBe(NO_LEVEL.level);
    expect(levelOf('unknown')).toBe(NO_LEVEL.level);
    expect(levelOf('other')).toBe(NO_LEVEL.level); // Eldorado
  });

  it('every word belongs to one level', () => {
    const words = wordsOf(LEVEL_OPTIONS.map((option) => option.level));
    expect(new Set(words).size).toBe(words.length);
    expect(wordsOf([NO_LEVEL.level])).toEqual([]);
  });
});

describe('parseLevels', () => {
  it("reads ?level= in the chips' order, leaving out what isn't a level and repeats", () => {
    expect(parseLevels('senior,mid')).toEqual(['mid', 'senior']);
    expect(parseLevels('senior,senior,boss, junior')).toEqual(['junior', 'senior']);
    expect(parseLevels('')).toEqual([]);
    expect(parseLevels(null)).toEqual([]);
  });

  it('every level at once is no filter', () => {
    expect(parseLevels(LEVEL_OPTIONS.map((option) => option.level).join(','))).toEqual([]);
  });
});

describe('toggleLevel', () => {
  it('switches a level on or off; none left is no ?level=', () => {
    expect(toggleLevel([], 'senior')).toBe('senior');
    expect(toggleLevel(['senior'], 'mid')).toBe('mid,senior');
    expect(toggleLevel(['mid', 'senior'], 'mid')).toBe('senior');
    expect(toggleLevel(['senior'], 'senior')).toBeNull();
  });

  it('switching on the last one left out is no filter either', () => {
    const allBut = LEVEL_OPTIONS.map((option) => option.level).filter((level) => level !== NO_LEVEL.level);
    expect(toggleLevel(allBut, NO_LEVEL.level)).toBeNull();
  });
});
