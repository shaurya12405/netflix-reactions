import { defineContentScript } from 'wxt/utils/define-content-script';
import { createNetflixAdapter } from '../../adapters/netflix';
import { startController } from '../../content/controller';

export default defineContentScript({
  // Netflix is a single-page app: viewers reach /watch/<id> from /browse
  // without a page load, and a content script matching only /watch/* would
  // never be injected. So we match the whole site but stay dormant (no UI, no
  // network) until the adapter reports a /watch/<id> page with a player.
  matches: ['*://www.netflix.com/*'],
  // Run before page scripts so our keyboard shield is registered first.
  runAt: 'document_start',
  main(ctx) {
    const stop = startController(window, createNetflixAdapter(window));
    ctx.onInvalidated(stop);
  },
});
