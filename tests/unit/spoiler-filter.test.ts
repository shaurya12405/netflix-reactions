import { describe, expect, it } from 'vitest';
import type { Comment } from '../../src/core/comment-types';
import { crossedComments, isCommentVisible, visibleThreads } from '../../src/core/spoiler-filter';
import { normalizeRanges } from '../../src/core/watched-ranges';

let seq = 0;
const c = (ts: number, extra: Partial<Comment> = {}): Comment => ({
  id: extra.id ?? `c${++seq}`,
  videoId: 'netflix:1',
  tsSeconds: ts,
  userId: 'someone',
  parentId: null,
  text: `at ${ts}`,
  isSpoiler: false,
  likeCount: 0,
  createdAt: '2026-11-25T10:00:00Z',
  ...extra,
});

describe('isCommentVisible', () => {
  const watched = normalizeRanges([[0, 600], [2400, 2460]]);

  it('shows comments inside watched ranges, inclusive', () => {
    expect(isCommentVisible(c(0), watched, null)).toBe(true);
    expect(isCommentVisible(c(600), watched, null)).toBe(true);
    expect(isCommentVisible(c(2430), watched, null)).toBe(true);
  });

  it('hides comments from the skipped part after a forward seek', () => {
    expect(isCommentVisible(c(1200), watched, null)).toBe(false);
    expect(isCommentVisible(c(600.5), watched, null)).toBe(false);
  });

  it('hides comments beyond everything watched', () => {
    expect(isCommentVisible(c(3000), watched, null)).toBe(false);
  });

  it('always shows the viewer their own comments', () => {
    expect(isCommentVisible(c(3000, { userId: 'me' }), watched, 'me')).toBe(true);
    expect(isCommentVisible(c(3000, { userId: 'me' }), watched, null)).toBe(false);
  });

  it('shows nothing when nothing has been watched', () => {
    expect(isCommentVisible(c(1), [], null)).toBe(false);
  });
});

describe('visibleThreads', () => {
  it('orders by timestamp, then creation time', () => {
    const list = [
      c(30, { id: 'b', createdAt: '2026-11-25T10:00:02Z' }),
      c(10, { id: 'a' }),
      c(30, { id: 'c', createdAt: '2026-11-25T10:00:01Z' }),
    ];
    const threads = visibleThreads(list, normalizeRanges([[0, 60]]), null);
    expect(threads.map((t) => t.comment.id)).toEqual(['a', 'c', 'b']);
  });

  it('a reply written later in the episode stays hidden until watched', () => {
    const parent = c(60, { id: 'p' });
    const earlyReply = c(70, { id: 'r1', parentId: 'p' });
    const lateReply = c(1800, { id: 'r2', parentId: 'p' });
    const threads = visibleThreads([parent, earlyReply, lateReply], normalizeRanges([[0, 120]]), null);
    expect(threads).toHaveLength(1);
    expect(threads[0]!.replies.map((r) => r.id)).toEqual(['r1']);
  });

  it('a reply is hidden when its parent is hidden, even if the reply itself was watched', () => {
    const parent = c(500, { id: 'p' });
    const reply = c(50, { id: 'r', parentId: 'p' });
    expect(visibleThreads([parent, reply], normalizeRanges([[0, 100]]), null)).toEqual([]);
  });

  it('seeking back keeps everything watched visible', () => {
    // Watched 0-300, now sitting at 100: comments up to 300 stay visible.
    const threads = visibleThreads([c(50), c(250), c(400)], normalizeRanges([[0, 300]]), null);
    expect(threads.map((t) => t.comment.tsSeconds)).toEqual([50, 250]);
  });
});

describe('crossedComments', () => {
  const list = [
    c(9.9, { id: 'before' }),
    c(10, { id: 'edge-from' }),
    c(10.2, { id: 'inside' }),
    c(10.5, { id: 'edge-to' }),
    c(10.3, { id: 'reply', parentId: 'inside' }),
    c(10.4, { id: 'spoiler', isSpoiler: true }),
    c(11, { id: 'after' }),
  ];

  it('returns top-level, non-spoiler comments in (from, to]', () => {
    expect(crossedComments(list, 10, 10.5).map((x) => x.id)).toEqual(['inside', 'edge-to']);
  });

  it('returns nothing for an empty step', () => {
    expect(crossedComments(list, 10, 10)).toEqual([]);
  });
});
