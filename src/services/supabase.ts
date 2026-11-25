/**
 * Supabase client factory. The background script owns the auth session; it
 * is persisted in extension storage (which the Netflix page cannot read).
 */
import { createClient, type SupabaseClient, type SupportedStorage } from '@supabase/supabase-js';
import { browser } from 'wxt/browser';
import type { SupabaseConfig } from '../config';
import type { Database } from '../types/database';

export type AppSupabaseClient = SupabaseClient<Database>;

/** Storage key prefix for the auth session (and the PKCE code verifier). */
export const AUTH_STORAGE_KEY = 'sb-auth';

/** supabase-js storage adapter backed by browser.storage.local. */
export const extensionStorage: SupportedStorage = {
  async getItem(key) {
    const result = await browser.storage.local.get(key);
    const value = result[key];
    return typeof value === 'string' ? value : null;
  },
  async setItem(key, value) {
    await browser.storage.local.set({ [key]: value });
  },
  async removeItem(key) {
    await browser.storage.local.remove(key);
  },
};

export function createBackgroundClient(config: SupabaseConfig): AppSupabaseClient {
  return createClient<Database>(config.url, config.anonKey, {
    auth: {
      storage: extensionStorage,
      storageKey: AUTH_STORAGE_KEY,
      flowType: 'pkce',
      persistSession: true,
      autoRefreshToken: true,
      // There is no page URL to read a session from in a service worker.
      detectSessionInUrl: false,
    },
  });
}
