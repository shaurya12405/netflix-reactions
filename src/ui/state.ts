/** UI state shared between the content-script controller and components. */
import { signal } from '@preact/signals';
import type { WatchedRanges } from '../core/watched-ranges';

export const videoId = signal<string | null>(null);
export const currentTime = signal(0);
export const paused = signal(true);
export const watchedRanges = signal<WatchedRanges>([]);
export const isFullscreen = signal(false);
