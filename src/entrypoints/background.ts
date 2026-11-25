import { defineBackground } from 'wxt/utils/define-background';
import { createAuthService, getRedirectUrl } from '../background/auth';
import { postComment } from '../background/comments';
import { getSupabaseConfig } from '../config';
import { listenForMessages } from '../services/messaging';
import { createBackgroundClient } from '../services/supabase';

export default defineBackground(() => {
  const config = getSupabaseConfig();
  const client = config ? createBackgroundClient(config) : null;
  const auth = createAuthService(client);

  listenForMessages({
    'auth:get-state': async () => auth.getState(),
    'auth:sign-in': async () => auth.signIn(),
    'auth:sign-out': async () => auth.signOut(),
    'auth:set-display-name': async ({ displayName }) => auth.setDisplayName(displayName),
    'auth:get-redirect-url': async () => getRedirectUrl(),
    'comments:post': async (request) => postComment(client, request),
  });
});
