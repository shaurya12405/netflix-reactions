/**
 * Which slices of a video's comments to fetch. Comments are fetched in
 * 60-second windows: everything the viewer has already watched (so the panel
 * can show it), plus the window at the playhead and the next one(s) ahead, so
 * comments are in memory before playback reaches them. Adjacent windows are
 * merged into one request.
 */
import type { WatchedRanges } from './watched-ranges';

export const WINDOW_SECONDS = 60;
export const LOOKAHEAD_WINDOWS = 1;

/** A half-open span [start, end) of media seconds to request. */
export type FetchSpan = readonly [start: number, end: number];

export const windowOf = (t: number): number => Math.max(0, Math.floor(t / WINDOW_SECONDS));

/** Window indices needed for these ranges and playhead. */
export function neededWindows(
  ranges: WatchedRanges,
  currentTime: number,
  lookahead: number = LOOKAHEAD_WINDOWS,
): Set<number> {
  const needed = new Set<number>();
  for (const [s, e] of ranges) {
    for (let w = windowOf(s); w <= windowOf(e); w++) needed.add(w);
  }
  if (Number.isFinite(currentTime) && currentTime >= 0) {
    const w0 = windowOf(currentTime);
    for (let w = w0; w <= w0 + lookahead; w++) needed.add(w);
  }
  return needed;
}

/** Merges window indices (not yet requested) into contiguous spans. */
export function spansToFetch(needed: Iterable<number>, requested: ReadonlySet<number>): FetchSpan[] {
  const todo = [...needed].filter((w) => !requested.has(w)).sort((a, b) => a - b);
  const spans: FetchSpan[] = [];
  let start: number | null = null;
  let prev = -2;
  for (const w of todo) {
    if (start !== null && w === prev + 1) {
      prev = w;
      continue;
    }
    if (start !== null) spans.push([start * WINDOW_SECONDS, (prev + 1) * WINDOW_SECONDS]);
    start = w;
    prev = w;
  }
  if (start !== null) spans.push([start * WINDOW_SECONDS, (prev + 1) * WINDOW_SECONDS]);
  return spans;
}

/** Window indices covered by a span (to mark them requested). */
export function windowsInSpan([start, end]: FetchSpan): number[] {
  const out: number[] = [];
  for (let w = windowOf(start); w * WINDOW_SECONDS < end; w++) out.push(w);
  return out;
}
