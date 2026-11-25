/**
 * Display-name rules. Mirrors the CHECK constraints on public.profiles so the
 * popup can explain problems before a round trip; the database stays the
 * source of truth.
 */
export const DISPLAY_NAME_MIN = 3;
export const DISPLAY_NAME_MAX = 20;

const RESERVED = new Set([
  'admin', 'administrator', 'mod', 'moderator', 'support', 'system', 'official',
  'scenetalk', 'scene_talk', 'scene.talk', 'netflix', 'anonymous', 'deleted',
]);

export type DisplayNameResult =
  | { readonly ok: true; readonly value: string }
  | { readonly ok: false; readonly reason: string };

export function validateDisplayName(raw: string): DisplayNameResult {
  const value = raw.trim();
  if (value.length < DISPLAY_NAME_MIN) {
    return { ok: false, reason: `Use at least ${DISPLAY_NAME_MIN} characters.` };
  }
  if (value.length > DISPLAY_NAME_MAX) {
    return { ok: false, reason: `Use at most ${DISPLAY_NAME_MAX} characters.` };
  }
  if (!/^[A-Za-z0-9_.]+$/.test(value)) {
    return { ok: false, reason: 'Use only letters, numbers, underscores and dots.' };
  }
  if (/(^\.|\.$|\.\.)/.test(value)) {
    return { ok: false, reason: 'Dots can’t be at the start, the end, or next to each other.' };
  }
  if (RESERVED.has(value.toLowerCase())) {
    return { ok: false, reason: 'That name is reserved. Please pick another.' };
  }
  return { ok: true, value };
}
