import { describe, expect, it } from 'vitest';
import { formatTimestamp } from '../../src/core/time-format';

describe('formatTimestamp', () => {
  it.each([
    [0, '0:00'],
    [5, '0:05'],
    [59.9, '0:59'],
    [60, '1:00'],
    [605, '10:05'],
    [3599, '59:59'],
    [3600, '1:00:00'],
    [3725, '1:02:05'],
    [36000, '10:00:00'],
  ])('%s s -> %s', (input, expected) => {
    expect(formatTimestamp(input)).toBe(expected);
  });

  it.each([-1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    'renders invalid input %s as 0:00',
    (input) => {
      expect(formatTimestamp(input)).toBe('0:00');
    },
  );
});
