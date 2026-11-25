/**
 * Netflix adapter. The ONLY file that knows about Netflix's URLs and DOM.
 *
 * What it reads: the episode/movie ID from the URL (/watch/<id>) and the page's
 * <video> element (for currentTime and media events, done by the caller).
 * It never touches DRM, the media stream, frames or any Netflix content.
 *
 * Netflix is a single-page app and its markup is undocumented, so everything
 * here is defensive: several candidate selectors, null checks, and a
 * MutationObserver + URL polling loop instead of relying on one signal.
 *
 * Browser checks (selectors may drift; see README "Verifying the adapter"):
 *  - PLAYER_CONTAINER_SELECTORS: which one wraps the <video> in practice.
 *  - The element Netflix passes to requestFullscreen(). We do not need to know
 *    it in advance: on fullscreenchange we re-mount inside
 *    document.fullscreenElement whenever it contains the video.
 */
import type { PlatformAdapter, PlayerSession } from './types';

const WATCH_PATH = /^\/watch\/(\d+)(?:[/?#]|$)/;

/** Candidate player wrappers, outermost first. First match wins. */
const PLAYER_CONTAINER_SELECTORS = [
  '[data-uia="watch-video"]',
  '.watch-video',
  '[data-uia="player"]',
  '.watch-video--player-view',
] as const;

/** URL polling interval. pushState from the page cannot be observed directly. */
const URL_POLL_MS = 500;
/** Coalescing delay for DOM mutation bursts (Netflix mutates constantly). */
const MUTATION_DEBOUNCE_MS = 150;

/** Extracts the numeric title ID from a Netflix watch URL, or null. Pure. */
export function parseNetflixVideoId(url: string): string | null {
  let pathname: string;
  try {
    const parsed = new URL(url);
    if (!/(^|\.)netflix\.com$/.test(parsed.hostname)) return null;
    pathname = parsed.pathname;
  } catch {
    return null;
  }
  return WATCH_PATH.exec(pathname)?.[1] ?? null;
}

/** Picks the main <video>: the largest connected one on the page. */
function findVideo(doc: Document): HTMLVideoElement | null {
  let best: HTMLVideoElement | null = null;
  let bestArea = -1;
  for (const v of Array.from(doc.querySelectorAll('video'))) {
    if (!v.isConnected) continue;
    const rect = v.getBoundingClientRect();
    const area = rect.width * rect.height;
    if (area > bestArea) {
      best = v;
      bestArea = area;
    }
  }
  return best;
}

function findMountPoint(doc: Document, video: HTMLVideoElement): HTMLElement | null {
  const fs = doc.fullscreenElement;
  // We cannot render inside a fullscreen <video> itself; Netflix fullscreens a
  // wrapper, but guard anyway.
  if (fs instanceof HTMLElement && fs !== video && fs.contains(video)) return fs;
  for (const selector of PLAYER_CONTAINER_SELECTORS) {
    const el = video.closest(selector);
    if (el instanceof HTMLElement) return el;
  }
  return video.parentElement;
}

function sameSession(a: PlayerSession | null, b: PlayerSession | null): boolean {
  if (a === null || b === null) return a === b;
  return a.videoId === b.videoId && a.video === b.video && a.mountPoint === b.mountPoint;
}

export function createNetflixAdapter(win: Window = window): PlatformAdapter {
  const doc = win.document;

  return {
    platform: 'netflix',

    observe(onChange) {
      let current: PlayerSession | null = null;
      let mutationTimer: ReturnType<typeof setTimeout> | null = null;
      let lastUrl = '';

      const evaluate = (): void => {
        mutationTimer = null;
        lastUrl = win.location.href;
        const videoId = parseNetflixVideoId(lastUrl);
        let next: PlayerSession | null = null;
        if (videoId) {
          const video = findVideo(doc);
          const mountPoint = video ? findMountPoint(doc, video) : null;
          if (video && mountPoint) next = { videoId, video, mountPoint };
        }
        if (!sameSession(current, next)) {
          current = next;
          onChange(next);
        }
      };

      const schedule = (): void => {
        if (mutationTimer === null) mutationTimer = setTimeout(evaluate, MUTATION_DEBOUNCE_MS);
      };

      // Our own UI lives in a shadow root, so its updates do not trigger this.
      const observer = new MutationObserver(schedule);
      observer.observe(doc.documentElement, { childList: true, subtree: true });

      const poll = setInterval(() => {
        if (win.location.href !== lastUrl) evaluate();
      }, URL_POLL_MS);

      const onFullscreen = (): void => evaluate();
      win.addEventListener('popstate', schedule);
      doc.addEventListener('fullscreenchange', onFullscreen);

      evaluate();

      return () => {
        observer.disconnect();
        clearInterval(poll);
        if (mutationTimer !== null) clearTimeout(mutationTimer);
        win.removeEventListener('popstate', schedule);
        doc.removeEventListener('fullscreenchange', onFullscreen);
        if (current !== null) {
          current = null;
          onChange(null);
        }
      };
    },
  };
}
