import { describe, expect, it } from 'vitest';
import {
  MAX_CONTINUOUS_STEP,
  addRange,
  continuousStep,
  createTracker,
  isWatched,
  furthestReached,
  normalizeRanges,
  reachTo,
  stepTracker,
  toReachedRanges,
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

describe('reachTo / furthestReached / toReachedRanges', () => {
  it('unlocks everything up to the furthest point', () => {
    expect(reachTo([], 90)).toEqual([[0, 90]]);
    expect(furthestReached(reachTo([], 90))).toBe(90);
    expect(furthestReached([])).toBe(0);
  });

  it('never moves backwards, and returns the same object when nothing changes', () => {
    const r = reachTo([], 300);
    expect(reachTo(r, 100)).toBe(r);
    expect(reachTo(r, 300)).toBe(r);
    expect(reachTo(r, 301)).toEqual([[0, 301]]);
  });

  it('converts gappy ranges from older versions to [0, furthest]', () => {
    expect(toReachedRanges(normalizeRanges([[0, 600], [2400, 2460]]))).toEqual([[0, 2460]]);
    expect(toReachedRanges([])).toEqual([]);
  });

  it('ignores invalid times', () => {
    const r = reachTo([], 10);
    expect(reachTo(r, Number.NaN)).toBe(r);
    expect(reachTo(r, -5)).toBe(r);
  });
});

describe('stepTracker (furthest point reached)', () => {
  it('playing unlocks up to the playhead', () => {
    expect(run(play(0, 60)).ranges).toEqual([[0, 60]]);
  });

  it('skipping forward unlocks everything before the new position', () => {
    const s = run([...play(0, 10, 1), { kind: 'seeking' }, { kind: 'seeked', time: 2400 }]);
    expect(s.ranges).toEqual([[0, 2400]]);
    expect(isWatched(s.ranges, 1200)).toBe(true);
    expect(isWatched(s.ranges, 2401)).toBe(false);
  });

  it('coming back keeps everything up to the furthest point unlocked', () => {
    const s = run([...play(0, 10, 1), { kind: 'seeking' }, { kind: 'seeked', time: 900 }, { kind: 'seeking' }, { kind: 'seeked', time: 100 }, ...play(100, 110, 1)]);
    expect(s.ranges).toEqual([[0, 900]]);
  });

  it('a position reached while paused counts too (e.g. resuming or dragging while paused)', () => {
    expect(run([tick(1500, { paused: true })]).ranges).toEqual([[0, 1500]]);
  });

  it('a jump seen only as a timeupdate counts the same as a seek', () => {
    expect(run([tick(10), tick(500)]).ranges).toEqual([[0, 500]]);
  });

  it('does not unlock while the player is mid-seek', () => {
    expect(run([tick(10), tick(800, { seeking: true })]).ranges).toEqual([[0, 10]]);
  });

  it('starts from stored progress, converting older gappy data', () => {
    const s = run([tick(50)], createTracker(normalizeRanges([[0, 100], [300, 320]])));
    expect(s.ranges).toEqual([[0, 320]]);
  });

  it('reset forgets the position but keeps what was unlocked', () => {
    const s = run([tick(0), tick(1), { kind: 'reset' }, tick(1.5)]);
    expect(s.ranges).toEqual([[0, 1.5]]);
    expect(s.lastTime).toBe(1.5);
  });

  it('ignores invalid times', () => {
    expect(run([tick(1), tick(Number.NaN), tick(-1), tick(2)]).ranges).toEqual([[0, 2]]);
  });

  it('returns the same state object when nothing changes (cheap re-renders)', () => {
    const s0 = createTracker();
    expect(stepTracker(s0, { kind: 'seeking' })).toBe(s0);
    const s1 = run([tick(5)]);
    expect(stepTracker(s1, tick(5))).toBe(s1);
  });
});

describe('continuousStep', () => {
  it('returns the segment for a small forward step while playing', () => {
    expect(continuousStep(10, tick(10.5))).toEqual([10, 10.5]);
  });

  it('is null when paused, seeking, first sample, backwards or a jump', () => {
    expect(continuousStep(10, tick(10.5, { paused: true }))).toBeNull();
    expect(continuousStep(10, tick(10.5, { seeking: true }))).toBeNull();
    expect(continuousStep(null, tick(10.5))).toBeNull();
    expect(continuousStep(10, tick(9))).toBeNull();
    expect(continuousStep(10, tick(10 + MAX_CONTINUOUS_STEP + 0.1))).toBeNull();
    expect(continuousStep(10, { kind: 'seeked', time: 11 })).toBeNull();
  });
});
