import { defineConfig } from 'wxt';
import preact from '@preact/preset-vite';

/**
 * Public half of the extension signing key. Pinning it gives every unpacked
 * Chrome install the same extension ID (ogpidfiegoigmchlfmmdempbapjlbcnp), which
 * keeps the OAuth redirect URL https://<id>.chromiumapp.org/ stable.
 * This is a PUBLIC key; it is safe to commit. The private key is not needed to
 * build or load the extension and must never be committed.
 */
const CHROME_PUBLIC_KEY =
  'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAq4U6ea95Z/82if+66fjoWZt8QIv/yzO9LxBnrQDo1LPzOzDl9NxWy+NamovZ3CNsezFFvbOp3T1D7YSILPPuh1vFegBQkkzsqe9V7MVQwLmNJ2b+wvTEiAtEBN8cEso9yyaM4EagzDx1nw1AkxDtCYBGJsBHgmr3cKKcf7c+OUUqzXHSV4N6GM1ZZS58NpDn4FocEd33mSW+5EhoHv8JDfvo+Huj87WTHvQ8d56SFYo1umaTdRf9AYtzd1+Cnrvlm0nrjGKDjQKAHuuCPwez2+uVxbQcBSChLwm8QXQfbLOgIhWszLP/62nLEdmBDr2iIPQDGEilrR6dK0AP9BHuTQIDAQAB';

/** Stable add-on ID for Firefox (also fixes the identity redirect URL). */
const GECKO_ID = '{ea318a04-d767-4b2f-8618-1080682a8576}';

export default defineConfig({
  srcDir: 'src',
  // Explicit imports everywhere: easier to read and review than auto-imports.
  imports: false,
  // Build MV3 for both browsers (WXT defaults Firefox to MV2).
  manifestVersion: 3,
  vite: () => ({
    plugins: [preact()],
  }),
  manifest: ({ browser }) => ({
    name: 'Scene Talk',
    description:
      'Spoiler-safe comments that replay at the exact moment they were written. Works with Netflix.',
    permissions: ['storage'],
    host_permissions: ['*://www.netflix.com/*'],
    ...(browser === 'firefox'
      ? {
          browser_specific_settings: {
            gecko: {
              id: GECKO_ID,
              strict_min_version: '140.0',
              // Required by AMO for new add-ons. M1 sends nothing anywhere;
              // this is revisited when sign-in and comments arrive (M2/M3).
              data_collection_permissions: { required: ['none'] },
            },
          },
        }
      : { key: CHROME_PUBLIC_KEY }),
  }),
});
