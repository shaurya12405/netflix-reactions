/** Build-time configuration from .env (see .env.example). */
export interface SupabaseConfig {
  readonly url: string;
  readonly anonKey: string;
}

/** Returns the Supabase config, or null when the build has none. */
export function getSupabaseConfig(): SupabaseConfig | null {
  const url = import.meta.env.WXT_SUPABASE_URL?.trim().replace(/\/+$/, '');
  const anonKey = import.meta.env.WXT_SUPABASE_ANON_KEY?.trim();
  if (!url || !anonKey) return null;
  return { url, anonKey };
}
