/**
 * Database types for supabase-js, matching supabase/migrations/.
 *
 * Hand-written in the shape `supabase gen types typescript` produces. After
 * changing a migration, regenerate against your project and diff:
 *   npx supabase@latest gen types typescript --linked --schema public > src/types/database.ts
 *
 * Row types list only the columns client roles are allowed to SELECT
 * (see the column grants in the migrations).
 */
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type ReactionEmoji = 'laugh' | 'shock' | 'cry' | 'fire';
export type ReportReason = 'spoiler' | 'harassment' | 'hate' | 'spam' | 'other';

export type Database = {
  __InternalSupabase: {
    PostgrestVersion: '12';
  };
  public: {
    Tables: {
      profiles: {
        Row: { id: string; display_name: string };
        Insert: { id: string; display_name: string };
        Update: { display_name?: string };
        Relationships: [];
      };
      comments: {
        Row: {
          id: string;
          video_id: string;
          ts_seconds: number;
          user_id: string;
          parent_id: string | null;
          text: string;
          is_spoiler: boolean;
          like_count: number;
          created_at: string;
        };
        /** Inserted only by the post-comment Edge Function (service role). */
        Insert: {
          id?: string;
          video_id: string;
          ts_seconds: number;
          user_id: string;
          parent_id?: string | null;
          text: string;
          is_spoiler?: boolean;
        };
        Update: never;
        Relationships: [
          {
            foreignKeyName: 'comments_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'comments_parent_id_fkey';
            columns: ['parent_id'];
            isOneToOne: false;
            referencedRelation: 'comments';
            referencedColumns: ['id'];
          },
        ];
      };
      likes: {
        Row: { user_id: string; comment_id: string; created_at: string };
        Insert: { user_id: string; comment_id: string };
        Update: never;
        Relationships: [
          {
            foreignKeyName: 'likes_comment_id_fkey';
            columns: ['comment_id'];
            isOneToOne: false;
            referencedRelation: 'comments';
            referencedColumns: ['id'];
          },
        ];
      };
      reactions: {
        Row: {
          id: string;
          video_id: string;
          ts_seconds: number;
          user_id: string;
          emoji: ReactionEmoji;
          created_at: string;
        };
        Insert: { video_id: string; ts_seconds: number; user_id?: string; emoji: ReactionEmoji };
        Update: never;
        Relationships: [];
      };
      reports: {
        Row: {
          id: string;
          comment_id: string;
          reporter_id: string;
          reason: ReportReason;
          details: string | null;
          created_at: string;
        };
        Insert: { comment_id: string; reporter_id?: string; reason: ReportReason; details?: string | null };
        Update: never;
        Relationships: [
          {
            foreignKeyName: 'reports_comment_id_fkey';
            columns: ['comment_id'];
            isOneToOne: false;
            referencedRelation: 'comments';
            referencedColumns: ['id'];
          },
        ];
      };
    };
    Views: { [_ in never]: never };
    Functions: {
      heatmap: {
        Args: { p_video_id: string };
        Returns: { bucket_start: number; comment_count: number; reaction_count: number }[];
      };
    };
    Enums: {
      reaction_emoji: ReactionEmoji;
      report_reason: ReportReason;
    };
    CompositeTypes: { [_ in never]: never };
  };
};
