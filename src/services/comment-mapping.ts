/** Converts database rows (snake_case, from REST or Realtime) to Comment. */
import type { Comment } from '../core/comment-types';

export interface CommentRowLike {
  id: string;
  video_id: string;
  ts_seconds: number | string;
  user_id: string;
  parent_id: string | null;
  text: string;
  is_spoiler: boolean;
  like_count: number | string;
  created_at: string;
}

export function rowToComment(row: CommentRowLike): Comment {
  return {
    id: row.id,
    videoId: row.video_id,
    tsSeconds: Number(row.ts_seconds),
    userId: row.user_id,
    parentId: row.parent_id ?? null,
    text: row.text,
    isSpoiler: row.is_spoiler === true,
    likeCount: Number(row.like_count) || 0,
    createdAt: row.created_at,
  };
}

/** Light runtime check for Realtime payloads before trusting their shape. */
export function isCommentRow(value: unknown): value is CommentRowLike {
  if (typeof value !== 'object' || value === null) return false;
  const r = value as Record<string, unknown>;
  return (
    typeof r.id === 'string' &&
    typeof r.video_id === 'string' &&
    (typeof r.ts_seconds === 'number' || typeof r.ts_seconds === 'string') &&
    typeof r.user_id === 'string' &&
    typeof r.text === 'string'
  );
}
