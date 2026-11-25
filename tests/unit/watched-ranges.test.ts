import { describe, expect, it } from 'vitest';
import {
  MAX_CONTINUOUS_STEP,
  addRange,
  createTracker,
  isWatched,
  normalizeRanges,
  stepTracker,
  totalWatched,
  type PlaybackSample,
  type TrackerState,
} from '../../src/core/watched-ranges';

const tick = (time: number, opts: Partial<{ paused: boolean; seeking: boolean }> = {}): PlaybackSample => ({
  kind: 'tick',
  time,
  paused: opts.paused ?? false,
  seeking: opts.seeking ?? false,
});

const run = (samples: PlaybackSample[], start: TrackerState = createTracker()): TrackerState =>
  samples.reduce(stepTracker, start);

/** Simulates continuous playback from a to b with timeupdate every `step` s. */
const play = (a: number, b: number, step = 0.25): PlaybackSample[] => {
  const out: PlaybackSample[] = [];
  for (let t = a; t <= b + 1e-9; t += step) out.push(tick(Math.round(t * 1000) / 1000));
  return out;
};

describe('normalizeRanges', () => {
  it('sorts and merges overlapping and adjacent ranges', () => {
    expect(normalizeRanges([[10, 20], [0, 5], [4, 8], [20.1, 25]])).toEqual([
      [0, 8],
      [10, 25],
    ]);
  });

  it('keeps ranges separated by more than the merge epsilon', () => {
    expect(normalizeRanges([[0, 5], [6, 7]])).toEqual([
      [0, 5],
      [6, 7],
    ]);
  });

  it('drops malformed input from storage', () => {
    expect(normalizeRanges('nope')).toEqual([]);
    expect(normalizeRanges(null)).toEqual([]);
    expect(normalizeRanges([[1], ['a', 2], [Number.NaN, 3], [1, Infinity], [2, 4]])).toEqual([[2, 4]]);
  });

  it('fixes reversed and negative ranges', () => {
    expect(normalizeRanges([[9, 3], [-5, 1]])).toEqual([
      [0, 1],
      [3, 9],
    ]);
  });
});

describe('isWatched', () => {
  const ranges = normalizeRanges([[0, 10], [30, 40], [100, 120]]);

  it('is inclusive at both ends', () => {
    expect(isWatched(ranges, 0)).toBe(true);
    expect(isWatched(ranges, 10)).toBe(true);
    expect(isWatched(ranges, 30)).toBe(true);
    expect(isWatched(ranges, 120)).toBe(true);
  });

  it('is false in gaps and beyond', () => {
    expect(isWatched(ranges, 10.01)).toBe(false);
    expect(isWatched(ranges, 50)).toBe(false);
    expect(isWatched(ranges, 121)).toBe(false);
    expect(isWatched([], 0)).toBe(false);
    expect(isWatched(ranges, Number.NaN)).toBe(false);
  });
});

describe('addRange / totalWatched', () => {
  it('accumulates and merges', () => {
    let r = addRange([], 0, 5);
    r = addRange(r, 5, 10);
    r = addRange(r, 20, 25);
    expect(r).toEqual([
      [0, 10],
      [20, 25],
    ]);
    expect(totalWatched(r)).toBe(15);
  });

  it('ignores non-finite input', () => {
    const r = addRange([[0, 1]], Number.NaN, 5);
    expect(r).toEqual([[0, 1]]);
  });
});

describe('stepTracker', () => {
  it('records continuous playback', () => {
    const s = run(play(0, 60));
    expect(s.ranges).toEqual([[0, 60]]);
  });

  it('a forward seek does NOT unlock the skipped part', () => {
    // Watch 0-600, jump to 2400 (with seek events), watch a minute.
    const s = run([...play(0, 600, 1), { kind: 'seeking' }, { kind: 'seeked', time: 2400 }, ...play(2400, 2460, 1)]);
    expect(s.ranges).toEqual([
      [0, 600],
      [2400, 2460],
    ]);
    expect(isWatched(s.ranges, 1200)).toBe(false);
    expect(isWatched(s.ranges, 2430)).toBe(true);
  });

  it('a jump larger than MAX_CONTINUOUS_STEP is treated as a seek even without seek events', () => {
    const s = run([tick(10), tick(10 + MAX_CONTINUOUS_STEP + 0.5)]);
    expect(s.ranges).toEqual([]);
    // Playback continues normally from the new position.
    expect(run([tick(10), tick(12.5), tick(13)]).ranges).toEqual([[12.5, 13]]);
    const s2 = run([tick(10), tick(10 + MAX_CONTINUOUS_STEP)]);
    expect(s2.ranges).toEqual([[10, 12]]);
  });

  it('measures continuity in media time: a long wall-clock gap between samples is fine', () => {
    // e.g. a tab throttled for a while: only currentTime deltas matter.
    const s = run([tick(100), tick(101.5), tick(103)]);
    expect(s.ranges).toEqual([[100, 103]]);
  });

  it('seeking backwards keeps earlier ranges and does not bridge', () => {
    const s = run([...play(0, 300, 1), { kind: 'seeking' }, { kind: 'seeked', time: 100 }, ...play(100, 120, 1)]);
    expect(s.ranges).toEqual([[0, 300]]);
  });

  it('a backwards jump without seek events records nothing new', () => {
    const s = run([tick(50), tick(51), tick(20), tick(21)]);
    expect(s.ranges).toEqual([
      [20, 21],
      [50, 51],
    ]);
  });

  it('does not record while paused or seeking', () => {
    const s = run([tick(5, { paused: true }), tick(6, { paused: true }), tick(7, { seeking: true }), tick(8)]);
    expect(s.ranges).toEqual([]);
  });

  it('a paused scrub then play only records from the new position', () => {
    const s = run([...play(0, 10, 1), tick(10, { paused: true }), tick(500, { paused: true }), tick(500), tick(501)]);
    expect(s.ranges).toEqual([
      [0, 10],
      [500, 501],
    ]);
  });

  it('reset forgets the previous position but keeps ranges', () => {
    const s = run([tick(0), tick(1), { kind: 'reset' }, tick(1.5)]);
    expect(s.ranges).toEqual([[0, 1]]);
    expect(s.lastTime).toBe(1.5);
  });

  it('ignores invalid times', () => {
    const s = run([tick(1), tick(Number.NaN), tick(2), tick(-1), tick(3)]);
    expect(s.ranges).toEqual([]);
  });

  it('returns the same state object when nothing changes (cheap re-renders)', () => {
    const s0 = createTracker();
    expect(stepTracker(s0, { kind: 'seeking' })).toBe(s0);
  });

  it('works at 2x playback speed with 250 ms timeupdates', () => {
    const s = run(play(0, 30, 0.5));
    expect(s.ranges).toEqual([[0, 30]]);
  });
});
