/**
 * Posting runs in the background, which holds the signed-in session; the
 * content script never sees the access token. All writes go through the
 * post-comment Edge Function.
 */
import { FunctionsHttpError } from '@supabase/supabase-js';
import type { Comment } from '../core/comment-types';
import { rowToComment, type CommentRowLike } from '../services/comment-mapping';
import type { AppSupabaseClient } from '../services/supabase';

export interface PostCommentRequest {
  readonly videoId: string;
  readonly tsSeconds: number;
  readonly text: string;
  readonly isSpoiler: boolean;
  readonly parentId: string | null;
}

export type PostCommentResponse =
  | { readonly ok: true; readonly comment: Comment }
  | { readonly ok: false; readonly error: string };

export async function postComment(
  client: AppSupabaseClient | null,
  request: PostCommentRequest,
): Promise<PostCommentResponse> {
  if (!client) return { ok: false, error: 'Scene Talk is not configured.' };
  const { data: auth } = await client.auth.getSession();
  if (!auth.session) return { ok: false, error: 'Sign in with the Scene Talk toolbar button to comment.' };

  const { data, error } = await client.functions.invoke<{ comment: CommentRowLike }>('post-comment', {
    body: request,
  });
  if (error) {
    let message = 'Could not post your comment. Please try again.';
    if (error instanceof FunctionsHttpError) {
      try {
        const body = (await error.context.json()) as { error?: unknown };
        if (typeof body.error === 'string') message = body.error;
      } catch {
        /* keep the generic message */
      }
    }
    return { ok: false, error: message };
  }
  if (!data?.comment) return { ok: false, error: 'Unexpected response from the server.' };
  return { ok: true, comment: rowToComment(data.comment) };
}
