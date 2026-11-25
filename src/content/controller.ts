/**
 * Content-script controller: wires the platform adapter to playback tracking,
 * persistence, comment sync and the UI. Platform-agnostic; all site knowledge
 * is in the adapter.
 */
import { h, render } from 'preact';
import { browser } from 'wxt/browser';
import type { PlatformAdapter, PlayerSession } from '../adapters/types';
import { getSupabaseConfig } from '../config';
import { isComposeHotkey, isTypingTarget, type ElementLike } from '../core/hotkeys';
import { crossedComments } from '../core/spoiler-filter';
import {
  continuousStep,
  createTracker,
  normalizeRanges,
  stepTracker,
  type PlaybackSample,
  type TrackerState,
} from '../core/watched-ranges';
import { createCommentsApi } from '../services/comments-api';
import { sendMessage } from '../services/messaging';
import { loadDisplayMode, saveDisplayMode, type DisplayMode } from '../services/settings';
import { AUTH_STORAGE_KEY } from '../services/supabase';
import { loadWatched, pruneWatched, saveWatched } from '../services/watched-store';
import { App, type AppActions } from '../ui/App';
import { installKeyboardShield } from '../ui/event-shield';
import { createShadowMount, type ShadowMount } from '../ui/mount';
import * as state from '../ui/state';
import { createCommentsSync } from './comments-sync';

/** How often unsaved progress is flushed to storage while playing. */
const SAVE_INTERVAL_MS = 5000;
/** How long a pop-up stays on screen (matches the CSS animation). */
const TOAST_MS = 5000;
const MAX_TOASTS = 3;

const log = (...args: unknown[]): void => console.debug('[Scene Talk]', ...args);
const warn = (...args: unknown[]): void => console.warn('[Scene Talk]', ...args);

export function startController(win: Window, adapter: PlatformAdapter): () => void {
  const doc = win.document;
  const config = getSupabaseConfig();
  const sync = createCommentsSync(config ? createCommentsApi(config) : null, warn);

  let mount: ShadowMount | null = null;
  let rendered = false;

  let activeVideoId: string | null = null;
  let activeVideo: HTMLVideoElement | null = null;
  let detachVideo: (() => void) | null = null;
  let tracker: TrackerState = createTracker();
  let dirty = false;
  let loadToken = 0;
  const toastTimers = new Set<ReturnType<typeof setTimeout>>();

  /** Database video ID, namespaced by platform (e.g. "netflix:80100172"). */
  const videoKey = (id: string): string => `${adapter.platform}:${id}`;

  // Install the keyboard shield first, at document_start, so it is registered
  // before any page listener.
  const removeKeyShield = installKeyboardShield(win, () => (mount?.host.isConnected ? mount.host : null));

  pruneWatched().catch((e: unknown) => warn('prune failed', e));

  // ---- Settings and auth ---------------------------------------------------
  loadDisplayMode()
    .then((m) => (state.mode.value = m))
    .catch((e: unknown) => warn('settings load failed', e));

  const refreshAuth = async (): Promise<void> => {
    try {
      const result = await sendMessage('auth:get-state', undefined);
      state.auth.value = 'error' in result ? null : result;
    } catch (e) {
      warn('auth state failed', e);
    }
  };
  void refreshAuth();
  const onStorageChange = (changes: Record<string, unknown>, area: string): void => {
    if (area === 'local' && AUTH_STORAGE_KEY in changes) void refreshAuth();
  };
  browser.storage.onChanged.addListener(onStorageChange);

  // ---- Pop-ups ---------------------------------------------------------------
  const showToasts = (from: number, to: number): void => {
    if (state.mode.value !== 'popups') return;
    const crossed = crossedComments(sync.comments.value.values(), from, to);
    if (crossed.length === 0) return;
    const fresh = crossed.map((comment) => ({ key: `${comment.id}@${Date.now()}`, comment }));
    state.toasts.value = [...state.toasts.value, ...fresh].slice(-MAX_TOASTS);
    for (const t of fresh) {
      const timer = setTimeout(() => {
        toastTimers.delete(timer);
        state.toasts.value = state.toasts.value.filter((x) => x.key !== t.key);
      }, TOAST_MS);
      toastTimers.add(timer);
    }
  };

  // ---- Playback tracking -----------------------------------------------------
  const flush = (): void => {
    if (!dirty || activeVideoId === null) return;
    dirty = false;
    saveWatched(adapter.platform, activeVideoId, tracker.ranges).catch((e: unknown) => {
      dirty = true;
      warn('save failed', e);
    });
  };

  const apply = (sample: PlaybackSample): void => {
    const step = continuousStep(tracker.lastTime, sample);
    const next = stepTracker(tracker, sample);
    if (next.ranges !== tracker.ranges) {
      dirty = true;
      state.watchedRanges.value = next.ranges;
    }
    tracker = next;
    if (step) showToasts(step[0], step[1]);
  };

  const sampleVideo = (video: HTMLVideoElement): PlaybackSample => ({
    kind: 'tick',
    time: video.currentTime,
    paused: video.paused,
    seeking: video.seeking,
  });

  const attachVideo = (video: HTMLVideoElement): (() => void) => {
    const onTick = (): void => {
      apply(sampleVideo(video));
      state.currentTime.value = video.currentTime;
      state.paused.value = video.paused;
      sync.ensure(tracker.ranges, video.currentTime);
    };
    const onSeeking = (): void => apply({ kind: 'seeking' });
    const onSeeked = (): void => {
      apply({ kind: 'seeked', time: video.currentTime });
      state.currentTime.value = video.currentTime;
      sync.ensure(tracker.ranges, video.currentTime);
    };
    const onPause = (): void => {
      onTick();
      flush();
    };
    // Source swapped on the same element (e.g. next episode reusing it).
    const onReset = (): void => apply({ kind: 'reset' });

    const listeners: [string, () => void][] = [
      ['timeupdate', onTick],
      ['play', onTick],
      ['playing', onTick],
      ['pause', onPause],
      ['seeking', onSeeking],
      ['seeked', onSeeked],
      ['emptied', onReset],
      ['loadstart', onReset],
    ];
    for (const [type, fn] of listeners) video.addEventListener(type, fn);
    onTick();
    return () => {
      for (const [type, fn] of listeners) video.removeEventListener(type, fn);
    };
  };

  const closeComposerState = (): void => {
    state.composer.value = { open: false, ts: 0, sending: false, error: null };
  };

  const switchVideoId = (videoId: string | null): void => {
    if (videoId === activeVideoId) return;
    flush();
    activeVideoId = videoId;
    tracker = createTracker();
    dirty = false;
    state.videoId.value = videoId;
    state.watchedRanges.value = [];
    state.currentTime.value = 0;
    state.toasts.value = [];
    closeComposerState();
    sync.setVideo(videoId === null ? null : videoKey(videoId));
    if (videoId === null) return;

    const token = ++loadToken;
    loadWatched(adapter.platform, videoId)
      .then((stored) => {
        if (token !== loadToken || stored.length === 0) return;
        // Merge with anything recorded while storage was loading.
        tracker = {
          ranges: normalizeRanges([...stored, ...tracker.ranges]),
          lastTime: tracker.lastTime,
        };
        state.watchedRanges.value = tracker.ranges;
        sync.ensure(tracker.ranges, state.currentTime.value);
      })
      .catch((e: unknown) => warn('load failed', e));
  };

  // ---- UI actions ------------------------------------------------------------
  const actions: AppActions = {
    setMode(mode: DisplayMode) {
      state.mode.value = mode;
      if (mode !== 'popups') state.toasts.value = [];
      saveDisplayMode(mode).catch((e: unknown) => warn('settings save failed', e));
    },
    openComposer() {
      // The timestamp is captured now, when the composer opens.
      const ts = activeVideo?.currentTime ?? state.currentTime.value;
      state.composer.value = { open: true, ts, sending: false, error: null };
      void refreshAuth();
    },
    closeComposer() {
      closeComposerState();
    },
    submitComment(text: string, isSpoiler: boolean) {
      const c = state.composer.value;
      if (!c.open || c.sending || activeVideoId === null) return;
      state.composer.value = { ...c, sending: true, error: null };
      const key = videoKey(activeVideoId);
      // Posting never touches the <video>, so playback keeps going.
      sendMessage('comments:post', { videoId: key, tsSeconds: c.ts, text, isSpoiler, parentId: null })
        .then((result) => {
          if (!state.composer.value.open) return;
          if (!result.ok) {
            state.composer.value = { ...state.composer.value, sending: false, error: result.error };
            return;
          }
          const me = state.auth.value;
          if (me?.status === 'signed-in' && me.displayName) sync.addNames(new Map([[me.userId, me.displayName]]));
          sync.addComments([result.comment]);
          closeComposerState();
        })
        .catch((e: unknown) => {
          state.composer.value = {
            ...state.composer.value,
            sending: false,
            error: e instanceof Error ? e.message : 'Could not post your comment.',
          };
        });
    },
  };

  // "c" opens the composer when you're not typing somewhere. Key events from
  // inside our own UI are swallowed by the keyboard shield before this runs.
  const onHotkey = (event: KeyboardEvent): void => {
    if (!isComposeHotkey(event) || !mount?.host.isConnected || state.mode.value === 'hidden') return;
    if (isTypingTarget(event.composedPath()[0] as ElementLike | undefined)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (!state.composer.value.open) actions.openComposer();
  };
  win.addEventListener('keydown', onHotkey, { capture: true });

  // ---- Sessions (navigation, episode change, fullscreen) -----------------------
  const onSession = (session: PlayerSession | null): void => {
    log('session', session ? { videoId: session.videoId } : null);

    if (session === null) {
      detachVideo?.();
      detachVideo = null;
      activeVideo = null;
      switchVideoId(null);
      mount?.detach();
      return;
    }

    switchVideoId(session.videoId);

    if (session.video !== activeVideo) {
      detachVideo?.();
      activeVideo = session.video;
      apply({ kind: 'reset' });
      detachVideo = attachVideo(session.video);
    }

    mount ??= createShadowMount(doc);
    mount.attachTo(session.mountPoint);
    if (!rendered) {
      render(h(App, { sync, actions }), mount.root);
      rendered = true;
    }
  };

  // Re-mounting on fullscreen is the adapter's job (it reports a new mount
  // point when needed); this only tracks the state.
  const onFullscreenChange = (): void => {
    state.isFullscreen.value = doc.fullscreenElement !== null;
  };
  doc.addEventListener('fullscreenchange', onFullscreenChange);

  const stopAdapter = adapter.observe(onSession);
  const saveTimer = setInterval(flush, SAVE_INTERVAL_MS);
  const onHidden = (): void => {
    if (doc.visibilityState === 'hidden') flush();
    else void refreshAuth();
  };
  doc.addEventListener('visibilitychange', onHidden);
  win.addEventListener('pagehide', flush);

  return () => {
    flush();
    stopAdapter();
    sync.dispose();
    clearInterval(saveTimer);
    for (const t of toastTimers) clearTimeout(t);
    doc.removeEventListener('visibilitychange', onHidden);
    doc.removeEventListener('fullscreenchange', onFullscreenChange);
    win.removeEventListener('pagehide', flush);
    win.removeEventListener('keydown', onHotkey, { capture: true });
    browser.storage.onChanged.removeListener(onStorageChange);
    removeKeyShield();
    detachVideo?.();
    if (mount) {
      render(null, mount.root);
      mount.destroy();
    }
  };
}
