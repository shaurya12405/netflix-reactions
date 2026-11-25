/**
 * Scene Talk's in-player UI: mode switcher, side panel or pop-ups, composer.
 * Placement keeps clear of the centre of the frame and the subtitle area.
 */
import { useLayoutEffect, useRef } from 'preact/hooks';
import { visibleThreads } from '../core/spoiler-filter';
import { formatTimestamp } from '../core/time-format';
import type { CommentsSync } from '../content/comments-sync';
import type { DisplayMode } from '../services/settings';
import { Composer } from './Composer';
import { ThreadItem } from './CommentItem';
import { ChatIcon, HideIcon, LockIcon, PanelIcon, PopupIcon } from './icons';
import * as state from './state';

export interface AppActions {
  setMode(mode: DisplayMode): void;
  openComposer(): void;
  closeComposer(): void;
  submitComment(text: string, isSpoiler: boolean): void;
}

interface Props {
  readonly sync: CommentsSync;
  readonly actions: AppActions;
}

function ModeBar({ actions }: { actions: AppActions }) {
  const mode = state.mode.value;
  return (
    <div class="st-modebar" role="group" aria-label="Scene Talk display mode">
      <button type="button" class="st-mode" aria-pressed={mode === 'panel'} onClick={() => actions.setMode('panel')}>
        <PanelIcon /> Panel
      </button>
      <button type="button" class="st-mode" aria-pressed={mode === 'popups'} onClick={() => actions.setMode('popups')}>
        <PopupIcon /> Pop-ups
      </button>
      <button type="button" class="st-mode" onClick={() => actions.setMode('hidden')} aria-label="Hide Scene Talk" data-testid="hide">
        <HideIcon /> Hide
      </button>
    </div>
  );
}

function ComposerSlot({ actions }: { actions: AppActions }) {
  const c = state.composer.value;
  if (c.open) {
    return (
      <Composer state={c} auth={state.auth.value} onSubmit={actions.submitComment} onCancel={actions.closeComposer} />
    );
  }
  return (
    <button type="button" class="st-compose-button" onClick={actions.openComposer} data-testid="compose">
      <ChatIcon /> Comment at {formatTimestamp(state.currentTime.value)}
      <kbd>C</kbd>
    </button>
  );
}

function Panel({ sync, actions }: Props) {
  const listRef = useRef<HTMLDivElement>(null);
  const nearBottom = useRef(true);
  const viewerId = state.auth.value?.status === 'signed-in' ? state.auth.value.userId : null;
  // Spoiler gating: only comments inside watched ranges (plus your own).
  const threads = visibleThreads(sync.comments.value.values(), state.watchedRanges.value, viewerId);
  const names = sync.names.value;
  const nameOf = (id: string): string => names.get(id) ?? 'viewer';
  const total = threads.reduce((n, t) => n + 1 + t.replies.length, 0);

  // Keep the newest revealed comment in view unless the user scrolled up.
  useLayoutEffect(() => {
    const el = listRef.current;
    if (el && nearBottom.current) el.scrollTop = el.scrollHeight;
  }, [total]);

  const status = sync.status.value;
  return (
    <aside class="st-panel" aria-label="Scene Talk comments" data-testid="panel" data-video-id={state.videoId.value ?? ''}>
      <header class="st-panel-head">
        <span class="st-title">Scene Talk</span>
        <span class="st-sub">
          {total} {total === 1 ? 'comment' : 'comments'} so far
          {sync.live.value === 'live' && (
            <span class="st-live" title="Receiving new comments live">
              <span class="st-dot" aria-hidden="true" /> Live
            </span>
          )}
        </span>
      </header>

      <div
        class="st-list"
        ref={listRef}
        onScroll={(e) => {
          const el = e.currentTarget as HTMLDivElement;
          nearBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        }}
      >
        {status === 'unconfigured' && <p class="st-note">This build isn’t connected to a server, so no comments can load.</p>}
        {status === 'error' && <p class="st-note st-error-note">Couldn’t load comments. Retrying…</p>}
        {threads.length === 0 && status !== 'unconfigured' && (
          <p class="st-note" data-testid="empty">
            No comments up to here yet. Press <kbd>C</kbd> to add the first.
          </p>
        )}
        {threads.map((t) => (
          <ThreadItem key={t.comment.id} thread={t} nameOf={nameOf} viewerId={viewerId} />
        ))}
        <p class="st-note st-locked">
          <LockIcon /> Later comments unlock as you watch.
        </p>
      </div>

      <div class="st-panel-foot">
        <ComposerSlot actions={actions} />
      </div>
    </aside>
  );
}

function PopupStack({ sync, actions }: Props) {
  const names = sync.names.value;
  return (
    <div class="st-popups">
      <div aria-live="polite">
        {state.toasts.value.map((t) => (
          <div class="st-toast" key={t.key} data-testid="toast">
            <div class="st-meta">
              <span class="st-name">{names.get(t.comment.userId) ?? 'viewer'}</span>
              <span class="st-ts">{formatTimestamp(t.comment.tsSeconds)}</span>
            </div>
            <p class="st-text">{t.comment.text}</p>
          </div>
        ))}
      </div>
      <div class="st-popup-compose">
        <ComposerSlot actions={actions} />
      </div>
    </div>
  );
}

export function App({ sync, actions }: Props) {
  const mode = state.mode.value;
  if (mode === 'hidden') {
    return (
      <button type="button" class="st-pill" onClick={() => actions.setMode('panel')} data-testid="show">
        <ChatIcon /> Show Scene Talk
      </button>
    );
  }
  return (
    <>
      <ModeBar actions={actions} />
      {mode === 'panel' ? <Panel sync={sync} actions={actions} /> : <PopupStack sync={sync} actions={actions} />}
    </>
  );
}
