import { describe, expect, it } from 'vitest';
import { neededWindows, spansToFetch, windowOf, windowsInSpan } from '../../src/core/windowing';
import { normalizeRanges } from '../../src/core/watched-ranges';

describe('windowOf', () => {
  it('maps seconds to 60 s windows', () => {
    expect(windowOf(0)).toBe(0);
    expect(windowOf(59.9)).toBe(0);
    expect(windowOf(60)).toBe(1);
    expect(windowOf(-5)).toBe(0);
  });
});

describe('neededWindows', () => {
  it('covers the playhead window plus one ahead', () => {
    expect([...neededWindows([], 125)].sort((a, b) => a - b)).toEqual([2, 3]);
  });

  it('also covers every watched range', () => {
    const ranges = normalizeRanges([[0, 130], [600, 610]]);
    expect([...neededWindows(ranges, 605)].sort((a, b) => a - b)).toEqual([0, 1, 2, 10, 11]);
  });

  it('ignores an invalid playhead', () => {
    expect([...neededWindows(normalizeRanges([[0, 10]]), Number.NaN)]).toEqual([0]);
  });
});

describe('spansToFetch', () => {
  it('merges adjacent windows into one request', () => {
    expect(spansToFetch([0, 1, 2, 10, 11], new Set())).toEqual([
      [0, 180],
      [600, 720],
    ]);
  });

  it('skips windows already requested', () => {
    expect(spansToFetch([0, 1, 2, 3], new Set([1]))).toEqual([
      [0, 60],
      [120, 240],
    ]);
  });

  it('returns nothing when all are requested', () => {
    expect(spansToFetch([4, 5], new Set([4, 5]))).toEqual([]);
  });
});

describe('windowsInSpan', () => {
  it('lists the windows a span covers', () => {
    expect(windowsInSpan([120, 300])).toEqual([2, 3, 4]);
  });
});
