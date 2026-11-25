/**
 * Validation for a new comment, shared by the post-comment Edge Function and
 * the extension's unit tests. Pure TypeScript: no Deno or browser APIs.
 *
 * The Edge Function writes with the service role (bypassing RLS), so it must
 * validate everything itself. The database CHECK constraints and triggers are
 * a second line of defence, not the first.
 */
export const VIDEO_ID_PATTERN = /^[a-z][a-z0-9]{1,19}:[A-Za-z0-9_-]{1,64}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const MAX_TEXT_CHARS = 200;
export const MAX_TS_SECONDS = 86400;

export interface CommentInput {
  readonly videoId: string;
  readonly tsSeconds: number;
  readonly text: string;
  readonly isSpoiler: boolean;
  readonly parentId: string | null;
}

export type ParseResult =
  | { readonly ok: true; readonly value: CommentInput }
  | { readonly ok: false; readonly error: string };

/** Characters, as Postgres char_length counts them (code points). */
export const charCount = (s: string): number => [...s].length;

/** Trims, normalises Unicode, turns any whitespace run into one space and drops control characters. */
export function normalizeCommentText(raw: string): string {
  return raw
    .normalize('NFC')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Parses an untrusted request body. Any `userId`/`user_id` field is ignored:
 * the author always comes from the verified JWT.
 */
export function parseCommentInput(body: unknown): ParseResult {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return { ok: false, error: 'Request body must be a JSON object.' };
  }
  const b = body as Record<string, unknown>;

  if (typeof b.videoId !== 'string' || !VIDEO_ID_PATTERN.test(b.videoId)) {
    return { ok: false, error: 'Invalid videoId.' };
  }
  if (typeof b.tsSeconds !== 'number' || !Number.isFinite(b.tsSeconds) || b.tsSeconds < 0 || b.tsSeconds >= MAX_TS_SECONDS) {
    return { ok: false, error: 'tsSeconds must be a number from 0 to 86399.' };
  }
  if (typeof b.text !== 'string') return { ok: false, error: 'text must be a string.' };
  const text = normalizeCommentText(b.text);
  if (text.length === 0) return { ok: false, error: 'Comment is empty.' };
  if (charCount(text) > MAX_TEXT_CHARS) return { ok: false, error: `Comment is longer than ${MAX_TEXT_CHARS} characters.` };

  if (b.isSpoiler !== undefined && typeof b.isSpoiler !== 'boolean') {
    return { ok: false, error: 'isSpoiler must be a boolean.' };
  }
  let parentId: string | null = null;
  if (b.parentId !== undefined && b.parentId !== null) {
    if (typeof b.parentId !== 'string' || !UUID_PATTERN.test(b.parentId)) {
      return { ok: false, error: 'Invalid parentId.' };
    }
    parentId = b.parentId.toLowerCase();
  }

  return {
    ok: true,
    value: {
      videoId: b.videoId,
      tsSeconds: Math.round(b.tsSeconds * 1000) / 1000,
      text,
      isSpoiler: b.isSpoiler === true,
      parentId,
    },
  };
}
