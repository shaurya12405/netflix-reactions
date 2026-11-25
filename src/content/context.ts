/**
 * Extension-context helpers. When the extension is reloaded or updated, Chrome
 * leaves the old content script running in open tabs but cuts it off from the
 * extension: every extension API call then throws "Extension context
 * invalidated". Such a script should shut down quietly, not log errors.
 */
export function isContextInvalidatedError(e: unknown): boolean {
  const message = e instanceof Error ? e.message : typeof e === 'string' ? e : '';
  return /extension context invalidated/i.test(message);
}
