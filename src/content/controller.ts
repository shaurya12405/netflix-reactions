/**
 * Content-script controller: wires the platform adapter to playback tracking,
 * persistence and the UI. Platform-agnostic; all site knowledge is in the
 * adapter.
 */
import { render, h } from 'preact';
import type { PlatformAdapter, PlayerSession } from '../adapters/types';
import {
  createTracker,
  normalizeRanges,
  stepTracker,
  type PlaybackSample,
  type TrackerState,
} from '../core/watched-ranges';
import { loadWatched, pruneWatched, saveWatched } from '../services/watched-store';
import { installKeyboardShield } from '../ui/event-shield';
import { createShadowMount, type ShadowMount } from '../ui/mount';
import { DebugPanel } from '../ui/DebugPanel';
import * as state from '../ui/state';

/** How often unsaved progress is flushed to storage while playing. */
const SAVE_INTERVAL_MS = 5000;

const log = (...args: unknown[]): void => console.debug('[Scene Talk]', ...args);
const warn = (...args: unknown[]): void => console.warn('[Scene Talk]', ...args);

export function startController(win: Window, adapter: PlatformAdapter): () => void {
  const doc = win.document;
  let mount: ShadowMount | null = null;
  let rendered = false;

  let activeVideoId: string | null = null;
  let activeVideo: HTMLVideoElement | null = null;
  let detachVideo: (() => void) | null = null;
  let tracker: TrackerState = createTracker();
  let dirty = false;
  let loadToken = 0;

  // Install the keyboard shield first, at document_start, so it is registered
  // before any Netflix listener.
  const removeKeyShield = installKeyboardShield(win, () =>
    mount?.host.isConnected ? mount.host : null,
  );

  pruneWatched().catch((e: unknown) => warn('prune failed', e));

  const flush = (): void => {
    if (!dirty || activeVideoId === null) return;
    dirty = false;
    saveWatched(adapter.platform, activeVideoId, tracker.ranges).catch((e: unknown) => {
      dirty = true;
      warn('save failed', e);
    });
  };

  const apply = (sample: PlaybackSample): void => {
    const next = stepTracker(tracker, sample);
    if (next.ranges !== tracker.ranges) {
      dirty = true;
      state.watchedRanges.value = next.ranges;
    }
    tracker = next;
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
    };
    const onSeeking = (): void => apply({ kind: 'seeking' });
    const onSeeked = (): void => {
      apply({ kind: 'seeked', time: video.currentTime });
      state.currentTime.value = video.currentTime;
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

  const switchVideoId = (videoId: string | null): void => {
    if (videoId === activeVideoId) return;
    flush();
    activeVideoId = videoId;
    tracker = createTracker();
    dirty = false;
    state.videoId.value = videoId;
    state.watchedRanges.value = [];
    state.currentTime.value = 0;
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
      })
      .catch((e: unknown) => warn('load failed', e));
  };

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
      render(h(DebugPanel, {}), mount.root);
      rendered = true;
    }
  };

  // Re-mounting on fullscreen is the adapter's job (it reports a new mount
  // point when needed); this only drives the UI indicator.
  const onFullscreenChange = (): void => {
    state.isFullscreen.value = doc.fullscreenElement !== null;
  };
  doc.addEventListener('fullscreenchange', onFullscreenChange);

  const stopAdapter = adapter.observe(onSession);
  const saveTimer = setInterval(flush, SAVE_INTERVAL_MS);
  const onHidden = (): void => {
    if (doc.visibilityState === 'hidden') flush();
  };
  doc.addEventListener('visibilitychange', onHidden);
  win.addEventListener('pagehide', flush);

  return () => {
    flush();
    stopAdapter();
    clearInterval(saveTimer);
    doc.removeEventListener('visibilitychange', onHidden);
    doc.removeEventListener('fullscreenchange', onFullscreenChange);
    win.removeEventListener('pagehide', flush);
    removeKeyShield();
    detachVideo?.();
    if (mount) {
      render(null, mount.root);
      mount.destroy();
    }
  };
}
