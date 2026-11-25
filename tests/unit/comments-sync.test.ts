import { describe, expect, it, vi } from 'vitest';
import { createCommentsSync } from '../../src/content/comments-sync';
import type { Comment } from '../../src/core/comment-types';
import type { FetchSpan } from '../../src/core/windowing';
import { normalizeRanges } from '../../src/core/watched-ranges';
import type { CommentsApi, LiveStatus } from '../../src/services/comments-api';

const comment = (id: string, ts: number, videoId = 'netflix:1', userId = 'u1'): Comment => ({
  id,
  videoId,
  tsSeconds: ts,
  userId,
  parentId: null,
  text: id,
  isSpoiler: false,
  likeCount: 0,
  createdAt: '2026-11-25T10:00:00Z',
});

function fakeApi(db: Comment[]) {
  const calls: [string, FetchSpan][] = [];
  let insert: ((c: Comment) => void) | null = null;
  let failNext = false;
  const api: CommentsApi = {
    fetchSpan: vi.fn(async (videoId: string, span: FetchSpan) => {
      calls.push([videoId, span]);
      if (failNext) {
        failNext = false;
        throw new Error('network down');
      }
      return {
        comments: db.filter((c) => c.videoId === videoId && c.tsSeconds >= span[0] && c.tsSeconds < span[1]),
        names: new Map([['u1', 'mira_k']]),
      };
    }),
    fetchNames: vi.fn(async (ids: readonly string[]) => new Map(ids.map((id) => [id, `name-${id}`]))),
    subscribe: vi.fn((_v: string, onInsert: (c: Comment) => void, onStatus: (s: LiveStatus) => void) => {
      insert = onInsert;
      onStatus('live');
      return () => {
        insert = null;
      };
    }),
  };
  return {
    api,
    calls,
    pushLive: (c: Comment) => insert?.(c),
    failOnce: () => {
      failNext = true;
    },
  };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('createCommentsSync', () => {
  it('fetches watched windows plus one ahead, merged into spans, once', async () => {
    const f = fakeApi([comment('a', 10), comment('b', 100), comment('c', 700)]);
    const sync = createCommentsSync(f.api);
    sync.setVideo('netflix:1');
    sync.ensure(normalizeRanges([[0, 70]]), 70);
    sync.ensure(normalizeRanges([[0, 75]]), 75); // same windows: no new request
    await flush();
    expect(f.calls).toEqual([['netflix:1', [0, 180]]]);
    expect([...sync.comments.value.keys()].sort()).toEqual(['a', 'b']);
    expect(sync.names.value.get('u1')).toBe('mira_k');
    expect(sync.status.value).toBe('ready');
  });

  it('fetches the window at a seek target without refetching earlier ones', async () => {
    const f = fakeApi([]);
    const sync = createCommentsSync(f.api);
    sync.setVideo('netflix:1');
    sync.ensure(normalizeRanges([[0, 30]]), 30);
    sync.ensure(normalizeRanges([[0, 30]]), 610);
    await flush();
    expect(f.calls.map((c) => c[1])).toEqual([
      [0, 120],
      [600, 720],
    ]);
  });

  it('retries a failed window after the back-off, not immediately', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      const f = fakeApi([comment('a', 10)]);
      const sync = createCommentsSync(f.api);
      sync.setVideo('netflix:1');
      f.failOnce();
      sync.ensure([], 10);
      await flush();
      expect(sync.status.value).toBe('error');
      sync.ensure([], 10);
      expect(f.calls).toHaveLength(1);
      vi.setSystemTime(Date.now() + 6000);
      sync.ensure([], 10);
      await flush();
      expect(f.calls).toHaveLength(2);
      expect(sync.comments.value.has('a')).toBe(true);
      expect(sync.status.value).toBe('ready');
    } finally {
      vi.useRealTimers();
    }
  });

  it('adds live inserts for the current video and looks up unknown names', async () => {
    const f = fakeApi([]);
    const sync = createCommentsSync(f.api);
    sync.setVideo('netflix:1');
    expect(sync.live.value).toBe('live');
    f.pushLive(comment('live1', 42, 'netflix:1', 'u9'));
    await flush();
    expect(sync.comments.value.has('live1')).toBe(true);
    expect(sync.names.value.get('u9')).toBe('name-u9');
  });

  it('switching video forgets the previous one and ignores its late results', async () => {
    const f = fakeApi([comment('old', 10, 'netflix:1'), comment('new', 10, 'netflix:2')]);
    const sync = createCommentsSync(f.api);
    sync.setVideo('netflix:1');
    sync.ensure([], 10);
    sync.setVideo('netflix:2'); // before the first fetch resolves
    sync.ensure([], 10);
    await flush();
    expect([...sync.comments.value.keys()]).toEqual(['new']);
  });

  it('does nothing without a server configured', () => {
    const sync = createCommentsSync(null);
    sync.setVideo('netflix:1');
    sync.ensure([], 10);
    expect(sync.status.value).toBe('unconfigured');
  });
});
