/**
 * Keeps the comments for the current video in memory: fetches 60-second
 * windows (watched parts + just ahead of the playhead) and merges in live
 * inserts from Realtime. What is *shown* is decided separately by the
 * spoiler filter; having a comment in memory never reveals it.
 */
import { signal } from '@preact/signals';
import type { Comment } from '../core/comment-types';
import type { WatchedRanges } from '../core/watched-ranges';
import { neededWindows, spansToFetch, windowsInSpan } from '../core/windowing';
import type { CommentsApi, LiveStatus } from '../services/comments-api';

export type SyncStatus = 'unconfigured' | 'idle' | 'loading' | 'ready' | 'error';

/** After a failed fetch, wait this long before trying again. */
const RETRY_DELAY_MS = 5000;

export function createCommentsSync(api: CommentsApi | null, warn: (...args: unknown[]) => void = () => {}) {
  const comments = signal<ReadonlyMap<string, Comment>>(new Map());
  const names = signal<ReadonlyMap<string, string>>(new Map());
  const status = signal<SyncStatus>(api ? 'idle' : 'unconfigured');
  const live = signal<LiveStatus>('offline');

  let videoKey: string | null = null;
  let generation = 0;
  let requested = new Set<number>();
  let inFlight = 0;
  let retryAt = 0;
  let unsubscribe: (() => void) | null = null;

  const addComments = (list: readonly Comment[]): void => {
    if (list.length === 0) return;
    const next = new Map(comments.value);
    for (const c of list) if (c.videoId === videoKey) next.set(c.id, c);
    comments.value = next;
  };

  const addNames = (more: ReadonlyMap<string, string>): void => {
    if (more.size === 0) return;
    names.value = new Map([...names.value, ...more]);
  };

  const onInsert = (comment: Comment): void => {
    const gen = generation;
    addComments([comment]);
    if (!api || names.value.has(comment.userId)) return;
    api
      .fetchNames([comment.userId])
      .then((found) => gen === generation && addNames(found))
      .catch((e: unknown) => warn('name lookup failed', e));
  };

  /** Switches to another video (or none): forgets everything from the previous one. */
  function setVideo(key: string | null): void {
    if (key === videoKey) return;
    generation++;
    unsubscribe?.();
    unsubscribe = null;
    videoKey = key;
    requested = new Set();
    inFlight = 0;
    retryAt = 0;
    comments.value = new Map();
    live.value = 'offline';
    if (!api) return;
    status.value = 'idle';
    if (key) unsubscribe = api.subscribe(key, onInsert, (s) => (live.value = s));
  }

  /** Fetches any windows not yet requested for these watched ranges and playhead. */
  function ensure(ranges: WatchedRanges, currentTime: number): void {
    if (!api || !videoKey || Date.now() < retryAt) return;
    const key = videoKey;
    const gen = generation;
    for (const span of spansToFetch(neededWindows(ranges, currentTime), requested)) {
      const windows = windowsInSpan(span);
      for (const w of windows) requested.add(w);
      inFlight++;
      status.value = 'loading';
      api
        .fetchSpan(key, span)
        .then((result) => {
          if (gen !== generation) return;
          addNames(result.names);
          addComments(result.comments);
          if (status.value !== 'error' || inFlight === 1) status.value = 'ready';
        })
        .catch((e: unknown) => {
          if (gen !== generation) return;
          for (const w of windows) requested.delete(w);
          retryAt = Date.now() + RETRY_DELAY_MS;
          status.value = 'error';
          warn('fetch failed', e);
        })
        .finally(() => {
          if (gen === generation) inFlight--;
        });
    }
  }

  function dispose(): void {
    generation++;
    unsubscribe?.();
    unsubscribe = null;
  }

  return { comments, names, status, live, setVideo, ensure, addComments, addNames, dispose };
}

export type CommentsSync = ReturnType<typeof createCommentsSync>;
