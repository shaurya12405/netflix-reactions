/**
 * Creates our Shadow DOM host. The shadow root isolates styles both ways:
 * Netflix CSS cannot reach our UI, and ours cannot leak into Netflix.
 */
import styles from './styles.css?inline';
import { shieldPointerEvents } from './event-shield';

export const HOST_TAG = 'scene-talk-root';

export interface ShadowMount {
  readonly host: HTMLElement;
  readonly root: HTMLElement;
  /** Moves the host into `parent` (no-op if already there). Keeps UI state. */
  attachTo(parent: HTMLElement): void;
  detach(): void;
  destroy(): void;
}

export function createShadowMount(doc: Document): ShadowMount {
  const host = doc.createElement(HOST_TAG);
  // Inline styles on the host so page CSS cannot easily reposition it.
  host.style.cssText =
    'all: initial; position: absolute; inset: 0; pointer-events: none; z-index: 2147483000; display: block;';
  const shadow = host.attachShadow({ mode: 'open' });
  const style = doc.createElement('style');
  style.textContent = styles;
  const root = doc.createElement('div');
  root.className = 'st-root';
  shadow.append(style, root);
  const unshield = shieldPointerEvents(host);

  return {
    host,
    root,
    attachTo(parent) {
      if (host.parentElement !== parent) parent.appendChild(host);
    },
    detach() {
      host.remove();
    },
    destroy() {
      unshield();
      host.remove();
    },
  };
}
