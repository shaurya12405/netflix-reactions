import { useCallback, useEffect, useState } from 'preact/hooks';
import { browser } from 'wxt/browser';
import type { ActionResult, AuthState } from '../../background/auth';
import { DISPLAY_NAME_MAX, validateDisplayName } from '../../core/display-name';
import { sendMessage } from '../../services/messaging';
import { AUTH_STORAGE_KEY } from '../../services/supabase';

const NETFLIX_ORIGINS = ['*://www.netflix.com/*'];

type Loaded = AuthState | { status: 'error'; error: string } | { status: 'loading' };

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}

function DisplayNameForm({ current, onDone }: { current: string | null; onDone: (r: ActionResult) => void }) {
  const [value, setValue] = useState(current ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: Event): Promise<void> => {
    e.preventDefault();
    const check = validateDisplayName(value);
    if (!check.ok) {
      setError(check.reason);
      return;
    }
    setBusy(true);
    setError(null);
    const result = await sendMessage('auth:set-display-name', { displayName: check.value });
    setBusy(false);
    if (!result.ok) setError(result.error);
    else onDone(result);
  };

  return (
    <form onSubmit={submit} class="stack">
      <label for="display-name">{current ? 'Change your display name' : 'Choose a display name'}</label>
      <p class="muted small">Shown next to your comments. Never your email.</p>
      <input
        id="display-name"
        value={value}
        maxLength={DISPLAY_NAME_MAX}
        autocomplete="off"
        spellcheck={false}
        aria-invalid={error ? 'true' : 'false'}
        aria-describedby={error ? 'display-name-error' : undefined}
        onInput={(e) => setValue((e.currentTarget as HTMLInputElement).value)}
        placeholder="e.g. mira_k"
      />
      {error && (
        <p id="display-name-error" class="error small" role="alert">
          {error}
        </p>
      )}
      <button type="submit" disabled={busy}>
        {busy ? 'Saving…' : 'Save'}
      </button>
    </form>
  );
}

function SetupInfo() {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    sendMessage('auth:get-redirect-url', undefined).then(setUrl, () => setUrl(null));
  }, []);
  if (!url) return null;
  return (
    <details class="setup">
      <summary>Sign-in setup info</summary>
      <p class="small muted">
        Redirect URL to allow in Supabase (Authentication → URL Configuration):
      </p>
      <code>{url}</code>
    </details>
  );
}

/**
 * Popup: site-access grant (Firefox), Google sign-in, display-name setup.
 */
export function App() {
  const [granted, setGranted] = useState<boolean | null>(null);
  const [state, setState] = useState<Loaded>({ status: 'loading' });
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editingName, setEditingName] = useState(false);

  const refresh = useCallback(async () => {
    const result = await sendMessage('auth:get-state', undefined).catch((e: unknown) => ({
      error: e instanceof Error ? e.message : String(e),
    }));
    setState('error' in result ? { status: 'error', error: result.error } : result);
  }, []);

  useEffect(() => {
    browser.permissions
      .contains({ origins: NETFLIX_ORIGINS })
      .then(setGranted)
      .catch(() => setGranted(null));
    void refresh();
    // Sign-in finishes in the background, often after this popup has closed
    // and reopened; refresh whenever the stored session changes.
    const onChange = (changes: Record<string, unknown>, area: string): void => {
      if (area === 'local' && AUTH_STORAGE_KEY in changes) void refresh();
    };
    browser.storage.onChanged.addListener(onChange);
    return () => browser.storage.onChanged.removeListener(onChange);
  }, [refresh]);

  const run = async (type: 'auth:sign-in' | 'auth:sign-out'): Promise<void> => {
    setBusy(true);
    setActionError(null);
    const result = await sendMessage(type, undefined).catch((e: unknown) => ({
      ok: false as const,
      error: e instanceof Error ? e.message : String(e),
    }));
    setBusy(false);
    if (result.ok) setState(result.state);
    else setActionError(result.error);
  };

  const requestAccess = async (): Promise<void> => {
    // Must be called directly from the click (user gesture).
    setGranted(await browser.permissions.request({ origins: NETFLIX_ORIGINS }));
  };

  return (
    <main class="stack">
      <header>
        <h1>Scene Talk</h1>
        <p class="muted small">v{browser.runtime.getManifest().version} · works with Netflix</p>
      </header>

      {granted === false && (
        <section class="warn stack">
          <p>Scene Talk needs access to netflix.com to show comments in the player.</p>
          <button type="button" onClick={requestAccess}>
            Allow access to netflix.com
          </button>
        </section>
      )}

      {state.status === 'loading' && <p class="muted">Loading…</p>}
      {state.status === 'error' && <p class="error">Something went wrong: {state.error}</p>}
      {state.status === 'unconfigured' && (
        <p class="muted">
          This build has no Supabase settings. Fill in <code>.env</code> and rebuild (see docs/SETUP.md).
        </p>
      )}

      {state.status === 'signed-out' && (
        <section class="stack">
          <p>Sign in to post, like and react. You can read comments without an account.</p>
          <button type="button" class="google" onClick={() => run('auth:sign-in')} disabled={busy}>
            <GoogleIcon />
            {busy ? 'Waiting for Google…' : 'Sign in with Google'}
          </button>
        </section>
      )}

      {state.status === 'signed-in' &&
        (state.displayName === null || editingName ? (
          <DisplayNameForm
            current={state.displayName}
            onDone={(r) => {
              if (r.ok) setState(r.state);
              setEditingName(false);
            }}
          />
        ) : (
          <section class="stack">
            <p>
              Commenting as <strong>{state.displayName}</strong>
            </p>
            <p class="muted small">Signed in with {state.email ?? 'Google'} (only you see this)</p>
            <div class="row">
              <button type="button" class="secondary" onClick={() => setEditingName(true)}>
                Change name
              </button>
              <button type="button" class="secondary" onClick={() => run('auth:sign-out')} disabled={busy}>
                Sign out
              </button>
            </div>
          </section>
        ))}

      {actionError && (
        <p class="error small" role="alert">
          {actionError}
        </p>
      )}

      {(state.status === 'signed-out' || actionError) && <SetupInfo />}
    </main>
  );
}
