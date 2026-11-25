/**
 * Read side, used from the content script: fetches comments and subscribes to
 * new ones. Comments are public (RLS allows anonymous reads), so this client
 * never holds a user session or token.
 */
import { createClient } from '@supabase/supabase-js';
import type { SupabaseConfig } from '../config';
import type { Comment } from '../core/comment-types';
import type { FetchSpan } from '../core/windowing';
import type { Database } from '../types/database';
import { isCommentRow, rowToComment } from './comment-mapping';

const PAGE_SIZE = 500;
/** Safety cap per span; a 60 s window with more than this is not realistic. */
const MAX_ROWS_PER_SPAN = 5000;
const COLUMNS = 'id, video_id, ts_seconds, user_id, parent_id, text, is_spoiler, like_count, created_at';

export interface FetchResult {
  readonly comments: Comment[];
  readonly names: Map<string, string>;
}

export type LiveStatus = 'connecting' | 'live' | 'offline';

export interface CommentsApi {
  fetchSpan(videoId: string, span: FetchSpan): Promise<FetchResult>;
  fetchNames(userIds: readonly string[]): Promise<Map<string, string>>;
  subscribe(videoId: string, onInsert: (comment: Comment) => void, onStatus: (s: LiveStatus) => void): () => void;
}

export function createCommentsApi(config: SupabaseConfig): CommentsApi {
  const client = createClient<Database>(config.url, config.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  return {
    async fetchSpan(videoId, [start, end]) {
      const comments: Comment[] = [];
      const names = new Map<string, string>();
      for (let from = 0; from < MAX_ROWS_PER_SPAN; from += PAGE_SIZE) {
        const { data, error } = await client
          .from('comments')
          .select(`${COLUMNS}, profiles(display_name)`)
          .eq('video_id', videoId)
          .gte('ts_seconds', start)
          .lt('ts_seconds', end)
          .order('ts_seconds')
          .order('id')
          .range(from, from + PAGE_SIZE - 1);
        if (error) throw new Error(error.message);
        for (const row of data) {
          comments.push(rowToComment(row));
          const name = row.profiles?.display_name;
          if (name) names.set(row.user_id, name);
        }
        if (data.length < PAGE_SIZE) break;
      }
      return { comments, names };
    },

    async fetchNames(userIds) {
      const names = new Map<string, string>();
      if (userIds.length === 0) return names;
      const { data, error } = await client.from('profiles').select('id, display_name').in('id', [...userIds]);
      if (error) throw new Error(error.message);
      for (const p of data) names.set(p.id, p.display_name);
      return names;
    },

    subscribe(videoId, onInsert, onStatus) {
      onStatus('connecting');
      const channel = client
        .channel(`comments:${videoId}`)
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'comments', filter: `video_id=eq.${videoId}` },
          (payload) => {
            if (isCommentRow(payload.new)) onInsert(rowToComment(payload.new));
          },
        )
        .subscribe((status) => {
          onStatus(status === 'SUBSCRIBED' ? 'live' : status === 'CLOSED' ? 'offline' : status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' ? 'offline' : 'connecting');
        });
      return () => {
        void client.removeChannel(channel);
      };
    },
  };
}
