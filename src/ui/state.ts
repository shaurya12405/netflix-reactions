/** UI state shared between the content-script controller and components. */
import { signal } from '@preact/signals';
import type { AuthState } from '../background/auth';
import type { Comment } from '../core/comment-types';
import type { WatchedRanges } from '../core/watched-ranges';
import type { DisplayMode } from '../services/settings';

export const videoId = signal<string | null>(null);
export const currentTime = signal(0);
export const paused = signal(true);
export const watchedRanges = signal<WatchedRanges>([]);
export const isFullscreen = signal(false);

export const mode = signal<DisplayMode>('panel');
export const auth = signal<AuthState | null>(null);

export interface ComposerState {
  readonly open: boolean;
  /** Media time captured when the composer opened. */
  readonly ts: number;
  readonly sending: boolean;
  readonly error: string | null;
}
export const composer = signal<ComposerState>({ open: false, ts: 0, sending: false, error: null });

export interface Toast {
  readonly key: string;
  readonly comment: Comment;
}
export const toasts = signal<readonly Toast[]>([]);
