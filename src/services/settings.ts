/** User preferences stored in extension storage (remembered across sessions). */
import { browser } from 'wxt/browser';

export type DisplayMode = 'panel' | 'popups' | 'hidden';
export const DISPLAY_MODES: readonly DisplayMode[] = ['panel', 'popups', 'hidden'];

const MODE_KEY = 'settings:displayMode';

export function parseDisplayMode(value: unknown): DisplayMode {
  return DISPLAY_MODES.includes(value as DisplayMode) ? (value as DisplayMode) : 'panel';
}

export async function loadDisplayMode(): Promise<DisplayMode> {
  const result = await browser.storage.local.get(MODE_KEY);
  return parseDisplayMode(result[MODE_KEY]);
}

export async function saveDisplayMode(mode: DisplayMode): Promise<void> {
  await browser.storage.local.set({ [MODE_KEY]: mode });
}
