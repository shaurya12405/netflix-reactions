/**
 * Keeps the host page from reacting to input aimed at our UI.
 *
 * Keyboard: Netflix listens for keys (space = play/pause, f = fullscreen,
 * arrows = seek). If any of those listeners run in the CAPTURE phase on
 * window/document, stopping propagation at our shadow host is too late: they
 * fire before the event ever reaches us. So we register capture listeners on
 * `window` at document_start, before any page script runs (listeners on the
 * same target and phase fire in registration order). For events originating
 * in our UI we call stopImmediatePropagation(), so no page listener sees them,
 * then hand the event to our own key router.
 *
 * Stopping propagation does not cancel the default action, so typing still
 * inserts text and `input` events still fire. What we lose is element-level
 * key listeners inside our UI; components use `onShieldedKey` instead.
 *
 * Pointer: Netflix toggles playback on clicks in the player. Those are bubble
 * listeners on ancestors of our host, so stopping at the host is enough, and
 * our own (Preact, element-level) handlers have already run by then.
 */

const KEY_EVENTS = ['keydown', 'keyup', 'keypress'] as const;
const POINTER_EVENTS = [
  'click',
  'dblclick',
  'auxclick',
  'mousedown',
  'mouseup',
  'pointerdown',
  'pointerup',
  'touchstart',
  'touchend',
  'wheel',
  'contextmenu',
] as const;

export type KeyHandler = (event: KeyboardEvent, target: EventTarget | null) => void;

const keyHandlers = new Set<KeyHandler>();

/** Registers a handler for key events that originate inside our UI. */
export function onShieldedKey(handler: KeyHandler): () => void {
  keyHandlers.add(handler);
  return () => keyHandlers.delete(handler);
}

/**
 * Installs the window-level keyboard shield. `getHost` returns our current
 * shadow host (or null when unmounted). Call once, as early as possible.
 */
export function installKeyboardShield(win: Window, getHost: () => Element | null): () => void {
  const listener = (event: Event): void => {
    const host = getHost();
    if (!host) return;
    const path = event.composedPath();
    if (!path.includes(host)) return;
    event.stopImmediatePropagation();
    const target = path[0] ?? null;
    for (const handler of keyHandlers) handler(event as KeyboardEvent, target);
  };
  for (const type of KEY_EVENTS) win.addEventListener(type, listener, { capture: true });
  return () => {
    for (const type of KEY_EVENTS) win.removeEventListener(type, listener, { capture: true });
  };
}

/** Stops pointer events from bubbling out of our host into the player. */
export function shieldPointerEvents(host: Element): () => void {
  const stop = (event: Event): void => event.stopPropagation();
  for (const type of POINTER_EVENTS) host.addEventListener(type, stop);
  return () => {
    for (const type of POINTER_EVENTS) host.removeEventListener(type, stop);
  };
}
