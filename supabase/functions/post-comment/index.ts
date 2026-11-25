/**
 * Edge Function: POST /functions/v1/post-comment
 *
 * The only way to create a comment. Verifies the caller's JWT (the author is
 * always the token's user, never a body field), validates and moderates the
 * input, then inserts with the service role. Deployed with verify_jwt = false
 * (see supabase/config.toml) because it verifies the token itself, which also
 * works with Supabase's newer JWT signing keys and publishable keys.
 */
import { createClient } from 'npm:@supabase/supabase-js@2';
import { allowAllModerator } from '../_shared/moderation.ts';
import { createPostCommentHandler, type CommentRow } from './handler.ts';

const url = Deno.env.get('SUPABASE_URL');
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
if (!url || !serviceKey) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set');

const admin = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});

const COMMENT_COLUMNS = 'id, video_id, ts_seconds, user_id, parent_id, text, is_spoiler, like_count, created_at';

Deno.serve(
  createPostCommentHandler({
    async getUserId(accessToken) {
      const { data, error } = await admin.auth.getUser(accessToken);
      return error ? null : (data.user?.id ?? null);
    },
    async findComment(id) {
      const { data } = await admin.from('comments').select('video_id, parent_id').eq('id', id).maybeSingle();
      return data ? { videoId: data.video_id as string, parentId: (data.parent_id as string | null) ?? null } : null;
    },
    async insertComment(row) {
      const { data, error } = await admin.from('comments').insert(row).select(COMMENT_COLUMNS).single();
      if (error) return { ok: false, code: error.code ?? null, message: error.message };
      return { ok: true, comment: data as CommentRow };
    },
    moderator: allowAllModerator,
    log: (message, details) => console.error(`[post-comment] ${message}`, details),
  }),
);
