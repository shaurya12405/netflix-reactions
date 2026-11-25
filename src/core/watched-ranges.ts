/**
 * Progress tracking for spoiler gating.
 *
 * Rule (product decision): a viewer may see everything up to the FURTHEST
 * point they have reached in a video, however they got there (playing,
 * skipping, dragging, resuming). Skipping ahead is the viewer's choice, and
 * going back never hides what was already unlocked. Anything beyond the
 * furthest point stays hidden.
 *
 * The unlocked part is stored as ranges ([[0, furthest]] in practice) so the
 * storage format and the filter stay general.
 *
 * Everything here is pure and immutable: functions return new arrays, or the
 * same object when nothing changed.
 */

/** Closed interval [start, end] in media seconds, start <= end. */
export type Range = readonly [start: number, end: number];
/** Sorted, non-overlapping ranges. Always produced by `normalizeRanges`. */
export type WatchedRanges = readonly Range[];

/** Ranges closer than this (seconds) are merged into one. */
export const MERGE_EPSILON = 0.25;

/**
 * Largest forward step in media time (seconds) between two consecutive samples
 * that counts as continuous playback (measured on currentTime deltas, never
 * wall-clock time). Only used to decide when a comment is "reached by
 * playback" for pop-ups; unlocking is by furthest position.
 */
export const MAX_CONTINUOUS_STEP = 2;

const isValidNumber = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

/**
 * Sorts, validates and merges ranges. Accepts untrusted input (e.g. from
 * storage) and drops anything malformed.
 */
export function normalizeRanges(input: unknown): WatchedRanges {
  if (!Array.isArray(input)) return [];
  const valid: [number, number][] = [];
  for (const item of input) {
    if (!Array.isArray(item) || item.length !== 2) continue;
    const [a, b] = item as unknown[];
    if (!isValidNumber(a) || !isValidNumber(b)) continue;
    const start = Math.max(0, Math.min(a, b));
    const end = Math.max(0, Math.max(a, b));
    valid.push([start, end]);
  }
  valid.sort((x, y) => x[0] - y[0]);
  const merged: [number, number][] = [];
  for (const [start, end] of valid) {
    const last = merged[merged.length - 1];
    if (last && start <= last[1] + MERGE_EPSILON) {
      last[1] = Math.max(last[1], end);
    } else {
      merged.push([start, end]);
    }
  }
  return merged;
}

/** Returns ranges with [start, end] added and merged. */
export function addRange(ranges: WatchedRanges, start: number, end: number): WatchedRanges {
  if (!isValidNumber(start) || !isValidNumber(end)) return ranges;
  return normalizeRanges([...ranges, [start, end]]);
}

/** True if media time `t` lies inside any watched range (inclusive). */
export function isWatched(ranges: WatchedRanges, t: number): boolean {
  if (!isValidNumber(t)) return false;
  // Binary search: ranges are sorted and disjoint.
  let lo = 0;
  let hi = ranges.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const r = ranges[mid]!;
    if (t < r[0]) hi = mid - 1;
    else if (t > r[1]) lo = mid + 1;
    else return true;
  }
  return false;
}

/** Total watched seconds. */
export function totalWatched(ranges: WatchedRanges): number {
  return ranges.reduce((sum, [s, e]) => sum + (e - s), 0);
}

/** The furthest point reached (end of the last range), or 0. */
export function furthestReached(ranges: WatchedRanges): number {
  return ranges.length === 0 ? 0 : ranges[ranges.length - 1]![1];
}

/** Everything up to `t` unlocked. Same object back if already covered. */
export function reachTo(ranges: WatchedRanges, t: number): WatchedRanges {
  if (!isValidNumber(t) || t < 0) return ranges;
  if (ranges.length === 1 && ranges[0]![0] === 0 && ranges[0]![1] >= t) return ranges;
  return [[0, Math.max(t, furthestReached(ranges))]];
}

/** Converts stored ranges (possibly with gaps, from older versions) to [[0, furthest]]. */
export function toReachedRanges(ranges: WatchedRanges): WatchedRanges {
  return ranges.length === 0 ? [] : reachTo([], furthestReached(ranges));
}

// ---------------------------------------------------------------------------
// Progress tracker: turns a stream of playback samples into unlocked ranges.
// ---------------------------------------------------------------------------

export interface TrackerState {
  readonly ranges: WatchedRanges;
  /** currentTime of the previous sample, or null after a seek/reset. */
  readonly lastTime: number | null;
}

export type PlaybackSample =
  /** A timeupdate (or polling) sample of the video element. */
  | { readonly kind: 'tick'; readonly time: number; readonly paused: boolean; readonly seeking: boolean }
  /** The video started seeking. */
  | { readonly kind: 'seeking' }
  /** The seek finished at `time`. */
  | { readonly kind: 'seeked'; readonly time: number }
  /** New video element or episode: forget the previous position. */
  | { readonly kind: 'reset' };

export function createTracker(ranges: WatchedRanges = []): TrackerState {
  return { ranges: toReachedRanges(ranges), lastTime: null };
}

export function stepTracker(state: TrackerState, sample: PlaybackSample): TrackerState {
  switch (sample.kind) {
    case 'reset':
    case 'seeking':
      return state.lastTime === null ? state : { ranges: state.ranges, lastTime: null };
    case 'seeked':
    case 'tick': {
      const { time } = sample;
      if (!isValidNumber(time) || time < 0 || (sample.kind === 'tick' && sample.seeking)) {
        return state.lastTime === null ? state : { ranges: state.ranges, lastTime: null };
      }
      // Any position the player actually reaches (played to, skipped to,
      // resumed at, paused at) unlocks everything before it.
      const ranges = reachTo(state.ranges, time);
      return ranges === state.ranges && state.lastTime === time ? state : { ranges, lastTime: time };
    }
  }
}

/**
 * The media-time segment [from, to] covered by continuous playback between
 * the previous sample and this one, or null (paused, seeking, first sample,
 * backwards or too-large jump). Used both for watched ranges and for
 * revealing comments "as playback reaches them".
 */
export function continuousStep(
  prevTime: number | null,
  sample: PlaybackSample,
): readonly [from: number, to: number] | null {
  if (sample.kind !== 'tick' || sample.paused || sample.seeking || prevTime === null) return null;
  if (!isValidNumber(sample.time) || sample.time < 0) return null;
  const delta = sample.time - prevTime;
  return delta > 0 && delta <= MAX_CONTINUOUS_STEP ? [prevTime, sample.time] : null;
}
