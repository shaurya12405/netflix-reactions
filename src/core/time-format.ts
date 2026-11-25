/**
 * Formats a playback position as m:ss, or h:mm:ss for an hour or more.
 * Fractions are floored (a comment at 59.9s shows as 0:59). Invalid or
 * negative input renders as 0:00 so the UI never shows "NaN:NaN".
 */
export function formatTimestamp(seconds: number): string {
  const total = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, '0');
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${ss}`;
  return `${m}:${ss}`;
}
