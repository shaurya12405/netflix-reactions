/**
 * Contract between the extension and a streaming site. Everything that knows
 * about a specific site's DOM lives behind this interface, so a site redesign
 * breaks one adapter file, and new platforms can be added without touching
 * the rest of the extension.
 */

/** A live player the extension can attach to. */
export interface PlayerSession {
  /** Stable, site-scoped identifier of the episode or movie being played. */
  readonly videoId: string;
  /** The element whose currentTime and media events we read. Read-only use. */
  readonly video: HTMLVideoElement;
  /**
   * Where our UI host is mounted. Must be inside whatever element the site
   * puts into fullscreen, so the panel stays visible there.
   */
  readonly mountPoint: HTMLElement;
}

export interface PlatformAdapter {
  /** Short identifier, e.g. "netflix". Used as a namespace for video IDs. */
  readonly platform: string;
  /**
   * Starts watching the page. Calls `onChange` whenever the session changes
   * (navigation, episode change, video element replaced, fullscreen change),
   * with `null` when no player is available. Returns a stop function.
   */
  observe(onChange: (session: PlayerSession | null) => void): () => void;
}
