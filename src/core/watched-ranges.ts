/**
 * Watched ranges: the set of media-time intervals a viewer has actually played
 * through. Spoiler gating is built on this, not on a single "furthest" number,
 * so skipping ahead never unlocks the skipped part.
 *
 * One allowance: a short forward hop (up to MAX_BRIDGED_HOP seconds, e.g. the
 * 10-second skip button) counts as watched, but only after at least
 * MIN_PLAY_BEFORE_HOP seconds of real playback since the previous hop, so
 * tapping skip repeatedly cannot unlock a long stretch.
 *
 * Everything here is pure and immutable: functions return new arrays.
 */

/** Closed interval [start, end] in media seconds, start <= end. */
export type Range = readonly [start: number, end: number];
/** Sorted, non-overlapping ranges. Always produced by `normalizeRanges`. */
export type WatchedRanges = readonly Range[];

/** Ranges closer than this (seconds) are merged into one. */
export const MERGE_EPSILON = 0.25;

/**
 * Largest forward step in media time (seconds) between two consecutive samples
 * that still counts as continuous playback. Larger jumps are treated as seeks.
 * Measured on currentTime deltas, never wall-clock time.
 */
export const MAX_CONTINUOUS_STEP = 2;

/**
 * Longest forward hop (seconds) that still counts as watched: a 10 s skip,
 * plus slack because the hop is measured from the last timeupdate, which can
 * be up to ~0.25 s (more if the tab is throttled) before the skip happened.
 */
export const MAX_BRIDGED_HOP = 11;

/** Seconds of real playback needed since the previous bridged hop. */
export const MIN_PLAY_BEFORE_HOP = 5;

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

// ---------------------------------------------------------------------------
// Progress tracker: turns a stream of playback samples into watched ranges.
// ---------------------------------------------------------------------------

export interface TrackerState {
  readonly ranges: WatchedRanges;
  /** currentTime of the previous sample, or null after a seek/reset. */
  readonly lastTime: number | null;
  /** Position when the current seek started (to judge a short hop), or null. */
  readonly seekFrom: number | null;
  /** Seconds of continuous playback since the last bridged hop (or start). */
  readonly playedSinceHop: number;
}

export type PlaybackSample =
  /** A timeupdate (or polling) sample of the video element. */
  | { readonly kind: 'tick'; readonly time: number; readonly paused: boolean; readonly seeking: boolean }
  /** The video started seeking: the next segment must not bridge the jump. */
  | { readonly kind: 'seeking' }
  /** The seek finished at `time`. */
  | { readonly kind: 'seeked'; readonly time: number }
  /** New video element or episode: forget the previous position. */
  | { readonly kind: 'reset' };

export function createTracker(ranges: WatchedRanges = []): TrackerState {
  return { ranges, lastTime: null, seekFrom: null, playedSinceHop: 0 };
}

/** True if a forward jump from `from` to `to` may count as watched. */
function canBridge(state: TrackerState, from: number | null, to: number): from is number {
  if (from === null) return false;
  const hop = to - from;
  return hop > 0 && hop <= MAX_BRIDGED_HOP && state.playedSinceHop >= MIN_PLAY_BEFORE_HOP;
}

export function stepTracker(state: TrackerState, sample: PlaybackSample): TrackerState {
  switch (sample.kind) {
    case 'reset':
      return state.lastTime === null && state.seekFrom === null && state.playedSinceHop === 0
        ? state
        : { ...state, lastTime: null, seekFrom: null, playedSinceHop: 0 };

    case 'seeking':
      // Keep the original start if several seeking events fire during one scrub.
      if (state.lastTime === null) return state;
      return { ...state, lastTime: null, seekFrom: state.seekFrom ?? state.lastTime };

    case 'seeked': {
      const time = isValidNumber(sample.time) ? sample.time : null;
      if (time !== null && canBridge(state, state.seekFrom, time)) {
        return { ranges: addRange(state.ranges, state.seekFrom, time), lastTime: time, seekFrom: null, playedSinceHop: 0 };
      }
      return { ...state, lastTime: time, seekFrom: null };
    }

    case 'tick': {
      const { time, seeking, paused } = sample;
      if (!isValidNumber(time) || time < 0 || seeking) {
        return state.lastTime === null ? state : { ...state, lastTime: null, seekFrom: state.seekFrom ?? state.lastTime };
      }
      const step = continuousStep(state.lastTime, sample);
      if (step) {
        return {
          ranges: addRange(state.ranges, step[0], step[1]),
          lastTime: time,
          seekFrom: null,
          playedSinceHop: state.playedSinceHop + (step[1] - step[0]),
        };
      }
      // A short forward jump seen without seek events (some players skip that way).
      if (!paused && canBridge(state, state.lastTime, time)) {
        return { ranges: addRange(state.ranges, state.lastTime, time), lastTime: time, seekFrom: null, playedSinceHop: 0 };
      }
      // Paused, first sample, backwards jump, or a forward jump that is too
      // long (or too soon after the last hop): re-anchor without recording.
      return { ...state, lastTime: time, seekFrom: null };
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
