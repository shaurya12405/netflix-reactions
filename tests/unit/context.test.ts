import { describe, expect, it } from 'vitest';
import { isContextInvalidatedError } from '../../src/content/context';

describe('isContextInvalidatedError', () => {
  it('recognises Chrome’s invalidation error', () => {
    expect(isContextInvalidatedError(new Error('Extension context invalidated.'))).toBe(true);
    expect(isContextInvalidatedError('Error: Extension context invalidated.')).toBe(true);
  });

  it('ignores other errors', () => {
    expect(isContextInvalidatedError(new Error('Failed to fetch'))).toBe(false);
    expect(isContextInvalidatedError(undefined)).toBe(false);
  });
});
