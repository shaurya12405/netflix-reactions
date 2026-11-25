/**
 * Persists watched ranges per video in extension-local storage
 * (chrome.storage.local), which the Netflix page cannot read.
 */
import { browser } from 'wxt/browser';
import { normalizeRanges, type WatchedRanges } from '../core/watched-ranges';
import { selectKeysToPrune } from '../core/storage-pruning';

const PREFIX = 'watched:';
/** Keep history for this many titles; older ones are dropped first. */
export const MAX_STORED_VIDEOS = 500;

interface StoredRecord {
  v: 1;
  ranges: [number, number][];
  updatedAt: number;
}

const keyFor = (platform: string, videoId: string): string => `${PREFIX}${platform}:${videoId}`;

export async function loadWatched(platform: string, videoId: string): Promise<WatchedRanges> {
  const key = keyFor(platform, videoId);
  const result = await browser.storage.local.get(key);
  const record = result[key] as Partial<StoredRecord> | undefined;
  return normalizeRanges(record?.ranges);
}

export async function saveWatched(
  platform: string,
  videoId: string,
  ranges: WatchedRanges,
): Promise<void> {
  const record: StoredRecord = {
    v: 1,
    ranges: ranges.map(([s, e]) => [s, e]),
    updatedAt: Date.now(),
  };
  await browser.storage.local.set({ [keyFor(platform, videoId)]: record });
}

/** Deletes the oldest records beyond MAX_STORED_VIDEOS. */
export async function pruneWatched(): Promise<number> {
  const all = await browser.storage.local.get(null);
  const records = Object.entries(all)
    .filter(([key]) => key.startsWith(PREFIX))
    .map(([key, value]) => ({
      key,
      updatedAt: Number((value as Partial<StoredRecord> | undefined)?.updatedAt) || 0,
    }));
  const toRemove = selectKeysToPrune(records, MAX_STORED_VIDEOS);
  if (toRemove.length > 0) await browser.storage.local.remove(toRemove);
  return toRemove.length;
}
