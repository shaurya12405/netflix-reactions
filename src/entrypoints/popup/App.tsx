import { useEffect, useState } from 'preact/hooks';
import { browser } from 'wxt/browser';

const NETFLIX_ORIGINS = ['*://www.netflix.com/*'];

/**
 * M1 popup: version info and, on Firefox, the site-access grant. Firefox MV3
 * can leave host permissions un-granted until the user allows them; without
 * them the content script never runs.
 */
export function App() {
  const [granted, setGranted] = useState<boolean | null>(null);

  useEffect(() => {
    browser.permissions
      .contains({ origins: NETFLIX_ORIGINS })
      .then(setGranted)
      .catch(() => setGranted(null));
  }, []);

  const request = async (): Promise<void> => {
    // Must be called directly from the click (user gesture).
    const ok = await browser.permissions.request({ origins: NETFLIX_ORIGINS });
    setGranted(ok);
  };

  return (
    <main>
      <h1>Scene Talk</h1>
      <p class="muted">v{browser.runtime.getManifest().version} · works with Netflix</p>
      {granted === false ? (
        <section class="warn">
          <p>Scene Talk needs access to netflix.com to show comments in the player.</p>
          <button type="button" onClick={request}>
            Allow access to netflix.com
          </button>
        </section>
      ) : (
        <p>Open any title on Netflix. The Scene Talk panel appears in the player.</p>
      )}
    </main>
  );
}
