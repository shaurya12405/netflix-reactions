/**
 * Google sign-in through Supabase OAuth (PKCE), run in the background script.
 *
 * It must not run in the popup: in Chrome the popup closes as soon as the
 * auth window takes focus, which would abort launchWebAuthFlow mid-way.
 */
import { browser } from 'wxt/browser';
import { validateDisplayName } from '../core/display-name';
import type { AppSupabaseClient } from '../services/supabase';

export type AuthState =
  | { readonly status: 'unconfigured' }
  | { readonly status: 'signed-out' }
  | {
      readonly status: 'signed-in';
      readonly userId: string;
      /** Shown only to the user themselves, in the popup. Never public. */
      readonly email: string | null;
      /** null until the user has chosen one. */
      readonly displayName: string | null;
    };

export type ActionResult = { readonly ok: true; readonly state: AuthState } | { readonly ok: false; readonly error: string };

/** The redirect URL Supabase must allow (differs between Chrome and Firefox). */
export function getRedirectUrl(): string {
  return browser.identity.getRedirectURL();
}

const message = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/**
 * Requests Supabase's authorize URL without following the redirect. A working
 * setup answers with a redirect to Google; a broken one (provider disabled,
 * wrong project URL) answers with an error we can show in plain words, which
 * launchWebAuthFlow would only report as "page could not be loaded".
 * Returns null when everything looks fine.
 */
async function preflightAuthorize(authorizeUrl: string): Promise<string | null> {
  let res: Response;
  try {
    res = await fetch(authorizeUrl, { redirect: 'manual', credentials: 'omit', cache: 'no-store' });
  } catch (e) {
    return `Could not reach Supabase at ${new URL(authorizeUrl).origin} (${message(e)}). Check WXT_SUPABASE_URL in .env, then rebuild.`;
  }
  if (res.type === 'opaqueredirect' || (res.status >= 300 && res.status < 400) || res.ok) return null;
  const body = await res.text().catch(() => '');
  let detail = `HTTP ${res.status}`;
  try {
    const json = JSON.parse(body) as Record<string, unknown>;
    const text = json.msg ?? json.error_description ?? json.message ?? json.error;
    if (typeof text === 'string') detail = text;
  } catch {
    /* not JSON */
  }
  if (/provider is not enabled/i.test(detail)) {
    return 'Google sign-in is not enabled in Supabase (Authentication → Sign In / Providers → Google). See docs/SETUP.md step 5.';
  }
  return `Supabase refused to start sign-in: ${detail}`;
}

/** Turns launchWebAuthFlow's terse errors into something actionable. */
export function explainAuthFlowError(raw: string): string {
  if (/did not approve|user cancel|closed/i.test(raw)) return 'Sign-in was cancelled.';
  if (/could not be loaded/i.test(raw)) {
    return (
      'The Google sign-in page failed to load. Check docs/SETUP.md steps 4–6: the redirect URI in Google Cloud, ' +
      'your account in Test users, and the extension redirect URL in Supabase (see "Sign-in setup info" below).'
    );
  }
  return `Sign-in failed (${raw}).`;
}

export function createAuthService(client: AppSupabaseClient | null) {
  async function getState(): Promise<AuthState> {
    if (!client) return { status: 'unconfigured' };
    const { data } = await client.auth.getSession();
    const user = data.session?.user;
    if (!user) return { status: 'signed-out' };
    const { data: profile, error } = await client
      .from('profiles')
      .select('id, display_name')
      .eq('id', user.id)
      .maybeSingle();
    if (error) throw new Error(`Could not load profile: ${error.message}`);
    return {
      status: 'signed-in',
      userId: user.id,
      email: user.email ?? null,
      displayName: profile?.display_name ?? null,
    };
  }

  async function signIn(): Promise<ActionResult> {
    if (!client) return { ok: false, error: 'Scene Talk is not configured (missing Supabase settings).' };
    const { data, error } = await client.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: getRedirectUrl(),
        skipBrowserRedirect: true,
        queryParams: { prompt: 'select_account' },
      },
    });
    if (error || !data.url) return { ok: false, error: error?.message ?? 'Could not start sign-in.' };

    const setupProblem = await preflightAuthorize(data.url);
    if (setupProblem) return { ok: false, error: setupProblem };

    let resultUrl: string | undefined;
    try {
      resultUrl = await browser.identity.launchWebAuthFlow({ url: data.url, interactive: true });
    } catch (e) {
      return { ok: false, error: explainAuthFlowError(message(e)) };
    }
    if (!resultUrl) return { ok: false, error: 'Sign-in returned no result.' };

    const url = new URL(resultUrl);
    const hash = new URLSearchParams(url.hash.slice(1));
    const oauthError =
      url.searchParams.get('error_description') ?? hash.get('error_description') ?? url.searchParams.get('error');
    if (oauthError) return { ok: false, error: oauthError };
    const code = url.searchParams.get('code');
    if (!code) return { ok: false, error: 'Sign-in returned no authorization code.' };

    const exchanged = await client.auth.exchangeCodeForSession(code);
    if (exchanged.error) return { ok: false, error: exchanged.error.message };
    return { ok: true, state: await getState() };
  }

  async function signOut(): Promise<ActionResult> {
    if (client) await client.auth.signOut({ scope: 'local' });
    return { ok: true, state: await getState() };
  }

  async function setDisplayName(raw: string): Promise<ActionResult> {
    if (!client) return { ok: false, error: 'Scene Talk is not configured.' };
    const check = validateDisplayName(raw);
    if (!check.ok) return { ok: false, error: check.reason };
    const state = await getState();
    if (state.status !== 'signed-in') return { ok: false, error: 'Please sign in first.' };

    // Insert or update explicitly: an upsert would also try to UPDATE `id`,
    // which clients have no privilege for.
    const { error } =
      state.displayName === null
        ? await client.from('profiles').insert({ id: state.userId, display_name: check.value })
        : await client.from('profiles').update({ display_name: check.value }).eq('id', state.userId);

    if (error) {
      if (error.code === '23505') return { ok: false, error: 'That name is taken. Try another.' };
      if (error.code === '23514') return { ok: false, error: 'That name isn’t allowed. Try another.' };
      return { ok: false, error: error.message };
    }
    return { ok: true, state: await getState() };
  }

  return { getState, signIn, signOut, setDisplayName };
}

export type AuthService = ReturnType<typeof createAuthService>;
