import { expect, it } from 'vitest';
import { arrange } from '@/features/applications/tile-order';

const defaults = ['a', 'b', 'c', 'd'];

it('keeps the default order until one is dragged', () => {
  expect(arrange(defaults, null)).toEqual(defaults);
  expect(arrange(defaults, 'not json')).toEqual(defaults);
  expect(arrange(defaults, '{"a":1}')).toEqual(defaults);
});

it('shows them as dragged', () => {
  expect(arrange(defaults, '["d","a","c","b"]')).toEqual(['d', 'a', 'c', 'b']);
});

it('drops a tile that is gone and puts a new one after the one it follows by default', () => {
  expect(arrange(defaults, '["d","gone","b","a"]')).toEqual(['d', 'b', 'c', 'a']);
  expect(arrange(['x', ...defaults], '["d","c","b","a"]')).toEqual(['x', 'd', 'c', 'b', 'a']);
});
