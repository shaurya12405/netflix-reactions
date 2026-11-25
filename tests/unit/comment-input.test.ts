import { describe, expect, it } from 'vitest';
import { normalizeCommentText, parseCommentInput } from '../../supabase/functions/_shared/comment-input.ts';

const valid = { videoId: 'netflix:80100172', tsSeconds: 12.3456, text: '  Hello   there ', isSpoiler: true };

describe('normalizeCommentText', () => {
  it('trims, collapses whitespace and strips control characters', () => {
    expect(normalizeCommentText('  a \n\t b\u0007c  ')).toBe('a bc');
  });
});

describe('parseCommentInput', () => {
  it('accepts and normalises a valid body', () => {
    const r = parseCommentInput(valid);
    expect(r).toEqual({
      ok: true,
      value: { videoId: 'netflix:80100172', tsSeconds: 12.346, text: 'Hello there', isSpoiler: true, parentId: null },
    });
  });

  it('ignores any user id in the body (author comes from the JWT)', () => {
    const r = parseCommentInput({ ...valid, userId: 'attacker', user_id: 'attacker' });
    expect(r.ok && Object.keys(r.value)).toEqual(['videoId', 'tsSeconds', 'text', 'isSpoiler', 'parentId']);
  });

  it('defaults isSpoiler to false and lower-cases parentId', () => {
    const r = parseCommentInput({ ...valid, isSpoiler: undefined, parentId: 'ABCDEF01-2345-4789-8BCD-EF0123456789' });
    expect(r.ok && r.value.isSpoiler).toBe(false);
    expect(r.ok && r.value.parentId).toBe('abcdef01-2345-4789-8bcd-ef0123456789');
  });

  it('counts characters like Postgres (emoji count once)', () => {
    expect(parseCommentInput({ ...valid, text: '😀'.repeat(200) }).ok).toBe(true);
    expect(parseCommentInput({ ...valid, text: '😀'.repeat(201) }).ok).toBe(false);
  });

  it.each([
    ['not an object', 'nope'],
    ['an array', []],
    ['missing videoId', { ...valid, videoId: undefined }],
    ['bad videoId', { ...valid, videoId: 'Netflix 1' }],
    ['negative ts', { ...valid, tsSeconds: -1 }],
    ['ts too large', { ...valid, tsSeconds: 86400 }],
    ['ts as string', { ...valid, tsSeconds: '12' }],
    ['NaN ts', { ...valid, tsSeconds: Number.NaN }],
    ['empty text', { ...valid, text: '   ' }],
    ['text too long', { ...valid, text: 'x'.repeat(201) }],
    ['text not a string', { ...valid, text: 5 }],
    ['isSpoiler not boolean', { ...valid, isSpoiler: 'yes' }],
    ['bad parentId', { ...valid, parentId: 'not-a-uuid' }],
  ])('rejects %s', (_label, body) => {
    expect(parseCommentInput(body).ok).toBe(false);
  });
});
