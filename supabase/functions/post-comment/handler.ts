/**
 * post-comment request handling, with all I/O injected so it can be unit
 * tested without Deno or a database. index.ts wires in the real Supabase calls.
 */
import { parseCommentInput } from '../_shared/comment-input.ts';
import type { Moderator } from '../_shared/moderation.ts';

/** The comment as returned to the client (database column names). */
export interface CommentRow {
  id: string;
  video_id: string;
  ts_seconds: number;
  user_id: string;
  parent_id: string | null;
  text: string;
  is_spoiler: boolean;
  like_count: number;
  created_at: string;
}

export interface NewCommentRow {
  video_id: string;
  ts_seconds: number;
  user_id: string;
  parent_id: string | null;
  text: string;
  is_spoiler: boolean;
}

export type InsertResult =
  | { ok: true; comment: CommentRow }
  | { ok: false; code: string | null; message: string };

export interface PostCommentDeps {
  /** Verifies the access token; returns the user ID, or null if invalid. */
  getUserId(accessToken: string): Promise<string | null>;
  findComment(id: string): Promise<{ videoId: string; parentId: string | null } | null>;
  insertComment(row: NewCommentRow): Promise<InsertResult>;
  moderator: Moderator;
  log?(message: string, details?: unknown): void;
}

export const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

const fail = (status: number, error: string): Response => json(status, { error });

/** Maps database errors (SQLSTATE codes from the migrations) to HTTP. */
function mapInsertError(code: string | null, message: string): Response {
  switch (code) {
    case 'ST429':
      return fail(429, 'You’re commenting too fast. Wait a moment and try again.');
    case '23503':
      return fail(409, 'Choose a display name first (Scene Talk toolbar button).');
    case 'ST400':
    case '23514':
      return fail(400, message);
    case 'ST404':
      return fail(404, 'The comment you replied to no longer exists.');
    default:
      return fail(500, 'Could not save your comment. Please try again.');
  }
}

export function createPostCommentHandler(deps: PostCommentDeps): (req: Request) => Promise<Response> {
  return async (req) => {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS });
    if (req.method !== 'POST') return fail(405, 'Method not allowed.');

    const auth = req.headers.get('Authorization') ?? '';
    const token = /^Bearer\s+(.+)$/i.exec(auth)?.[1]?.trim();
    if (!token) return fail(401, 'Sign in to comment.');
    const userId = await deps.getUserId(token);
    if (!userId) return fail(401, 'Your session has expired. Sign in again.');

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return fail(400, 'Request body must be JSON.');
    }
    const parsed = parseCommentInput(body);
    if (!parsed.ok) return fail(400, parsed.error);
    const input = parsed.value;

    if (input.parentId !== null) {
      const parent = await deps.findComment(input.parentId);
      if (!parent) return fail(404, 'The comment you replied to no longer exists.');
      if (parent.parentId !== null) return fail(400, 'Replies can only be one level deep.');
      if (parent.videoId !== input.videoId) return fail(400, 'A reply must be on the same video as its parent.');
    }

    const verdict = await deps.moderator.check({ text: input.text, userId });
    if (!verdict.allowed) return fail(422, verdict.reason);

    const result = await deps.insertComment({
      video_id: input.videoId,
      ts_seconds: input.tsSeconds,
      user_id: userId,
      parent_id: input.parentId,
      text: input.text,
      is_spoiler: input.isSpoiler,
    });
    if (!result.ok) {
      if (!['ST429', '23503', 'ST400', '23514', 'ST404'].includes(result.code ?? '')) {
        deps.log?.('insert failed', { code: result.code, message: result.message });
      }
      return mapInsertError(result.code, result.message);
    }
    return json(201, { comment: result.comment });
  };
}
