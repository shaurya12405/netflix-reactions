import { defineBackground } from 'wxt/utils/define-background';
import { createAuthService, getRedirectUrl } from '../background/auth';
import { getSupabaseConfig } from '../config';
import { probeConnectivity } from '../services/connectivity';
import { listenForMessages } from '../services/messaging';
import { createBackgroundClient } from '../services/supabase';

export default defineBackground(() => {
  const config = getSupabaseConfig();
  const auth = createAuthService(config ? createBackgroundClient(config) : null);

  listenForMessages({
    'probe-connectivity': async () => {
      if (!config) return { error: 'Supabase not configured' };
      return probeConnectivity(config);
    },
    'auth:get-state': async () => auth.getState(),
    'auth:sign-in': async () => auth.signIn(),
    'auth:sign-out': async () => auth.signOut(),
    'auth:set-display-name': async ({ displayName }) => auth.setDisplayName(displayName),
    'auth:get-redirect-url': async () => getRedirectUrl(),
  });
});
