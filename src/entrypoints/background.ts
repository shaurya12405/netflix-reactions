import { defineBackground } from 'wxt/utils/define-background';
import { getSupabaseConfig } from '../config';
import { probeConnectivity } from '../services/connectivity';
import { listenForMessages } from '../services/messaging';

export default defineBackground(() => {
  listenForMessages({
    'probe-connectivity': async () => {
      const config = getSupabaseConfig();
      if (!config) return { error: 'Supabase not configured' };
      return probeConnectivity(config);
    },
  });
});
