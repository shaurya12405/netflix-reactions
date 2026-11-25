import { describe, expect, it } from 'vitest';
import { validateDisplayName } from '../../src/core/display-name';

describe('validateDisplayName', () => {
  it.each(['mira_k', 'Bob.Watches', 'abc', 'a_b.c_d', 'x'.repeat(20), '  trimmed  '])('accepts %j', (name) => {
    const r = validateDisplayName(name);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe(name.trim());
  });

  it.each([
    ['ab', /at least 3/],
    ['x'.repeat(21), /at most 20/],
    ['bo b', /letters, numbers/],
    ['émile', /letters, numbers/],
    ['a@b.com', /letters, numbers/],
    ['.bob', /Dots/],
    ['bob.', /Dots/],
    ['b..ob', /Dots/],
    ['Admin', /reserved/],
    ['NETFLIX', /reserved/],
    ['scene.talk', /reserved/],
  ])('rejects %j', (name, reason) => {
    const r = validateDisplayName(name);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(reason);
  });
});
