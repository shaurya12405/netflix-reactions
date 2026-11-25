/**
 * Chooses which stored per-video records to delete so that at most `max`
 * remain, keeping the most recently updated ones. Pure; the caller does the I/O.
 */
export interface PrunableRecord {
  readonly key: string;
  readonly updatedAt: number;
}

export function selectKeysToPrune(records: readonly PrunableRecord[], max: number): string[] {
  if (records.length <= max) return [];
  return [...records]
    .sort((a, b) => b.updatedAt - a.updatedAt || a.key.localeCompare(b.key))
    .slice(Math.max(0, max))
    .map((r) => r.key);
}
