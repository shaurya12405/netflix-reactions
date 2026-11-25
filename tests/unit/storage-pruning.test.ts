import { describe, expect, it } from 'vitest';
import { selectKeysToPrune } from '../../src/core/storage-pruning';

describe('selectKeysToPrune', () => {
  it('returns nothing when under the limit', () => {
    expect(selectKeysToPrune([{ key: 'a', updatedAt: 1 }], 5)).toEqual([]);
  });

  it('removes the least recently updated beyond the limit', () => {
    const records = [
      { key: 'old', updatedAt: 1 },
      { key: 'new', updatedAt: 30 },
      { key: 'mid', updatedAt: 20 },
      { key: 'older', updatedAt: 0 },
    ];
    expect(selectKeysToPrune(records, 2).sort()).toEqual(['old', 'older']);
  });

  it('handles a zero limit', () => {
    expect(selectKeysToPrune([{ key: 'a', updatedAt: 1 }], 0)).toEqual(['a']);
  });
});
