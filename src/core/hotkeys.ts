/**
 * Keyboard helpers. Pure: they take minimal event/element shapes so they can
 * be unit-tested without a DOM.
 */
export interface ElementLike {
  readonly tagName?: string;
  readonly isContentEditable?: boolean;
  readonly type?: string;
}

export interface KeyEventLike {
  readonly key: string;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly altKey: boolean;
  readonly shiftKey: boolean;
  readonly repeat: boolean;
}

const NON_TEXT_INPUTS = new Set(['button', 'checkbox', 'radio', 'range', 'color', 'file', 'image', 'reset', 'submit']);

/** True if keystrokes on this element are text entry (so hotkeys must not fire). */
export function isTypingTarget(el: ElementLike | null | undefined): boolean {
  if (!el) return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName?.toUpperCase();
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag === 'INPUT') return !NON_TEXT_INPUTS.has((el.type ?? 'text').toLowerCase());
  return false;
}

/** The "c" shortcut: plain lower-case c, no modifiers, not auto-repeat. */
export function isComposeHotkey(e: KeyEventLike): boolean {
  return e.key === 'c' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey && !e.repeat;
}
