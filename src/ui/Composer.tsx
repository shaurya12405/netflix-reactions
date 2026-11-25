import { useEffect, useRef, useState } from 'preact/hooks';
import type { AuthState } from '../background/auth';
import { formatTimestamp } from '../core/time-format';
import { onShieldedKey } from './event-shield';
import type { ComposerState } from './state';

const MAX_CHARS = 200;

interface Props {
  readonly state: ComposerState;
  readonly auth: AuthState | null;
  readonly onSubmit: (text: string, isSpoiler: boolean) => void;
  readonly onCancel: () => void;
}

function Gate({ children, onCancel }: { children: preact.ComponentChildren; onCancel: () => void }) {
  return (
    <div class="st-composer st-composer-gate" data-testid="composer-gate">
      <p>{children}</p>
      <button type="button" class="st-link" onClick={onCancel}>
        Close
      </button>
    </div>
  );
}

export function Composer({ state, auth, onSubmit, onCancel }: Props) {
  const [text, setText] = useState('');
  const [spoiler, setSpoiler] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, [auth?.status]);

  // Key events inside our UI never reach element listeners (see event-shield),
  // so Escape is handled here. Enter submits through the form's default action.
  useEffect(
    () =>
      onShieldedKey((event, target) => {
        if (event.type === 'keydown' && event.key === 'Escape' && target === inputRef.current) onCancel();
      }),
    [onCancel],
  );

  if (!auth || auth.status === 'unconfigured') {
    return <Gate onCancel={onCancel}>Scene Talk isn’t connected to a server in this build.</Gate>;
  }
  if (auth.status === 'signed-out') {
    return (
      <Gate onCancel={onCancel}>
        Sign in to comment: click the Scene Talk icon in your browser toolbar, then “Sign in with Google”.
      </Gate>
    );
  }
  if (auth.displayName === null) {
    return <Gate onCancel={onCancel}>Choose a display name first: click the Scene Talk icon in your browser toolbar.</Gate>;
  }

  const count = [...text].length;
  const trimmed = text.trim();
  const submit = (e: Event): void => {
    e.preventDefault();
    if (!trimmed || count > MAX_CHARS || state.sending) return;
    onSubmit(trimmed, spoiler);
  };

  return (
    <form class="st-composer" onSubmit={submit} data-testid="composer">
      <label class="st-composer-label" for="st-composer-input">
        Comment at <span class="st-ts">{formatTimestamp(state.ts)}</span> as {auth.displayName}
      </label>
      <div class="st-composer-row">
        <input
          id="st-composer-input"
          ref={inputRef}
          class="st-input"
          type="text"
          value={text}
          maxLength={MAX_CHARS * 2}
          placeholder="Say something about this moment…"
          autocomplete="off"
          data-testid="composer-input"
          aria-describedby="st-composer-hint"
          onInput={(e) => setText((e.currentTarget as HTMLInputElement).value)}
          disabled={state.sending}
        />
        <button type="submit" class="st-primary" disabled={!trimmed || count > MAX_CHARS || state.sending}>
          {state.sending ? 'Posting…' : 'Post'}
        </button>
      </div>
      <div class="st-composer-row st-composer-foot">
        <label class="st-check">
          <input type="checkbox" checked={spoiler} onChange={(e) => setSpoiler((e.currentTarget as HTMLInputElement).checked)} />
          Contains a spoiler
        </label>
        <span id="st-composer-hint" class={count > MAX_CHARS ? 'st-count st-over' : 'st-count'}>
          {count}/{MAX_CHARS} · Esc to cancel
        </span>
      </div>
      {state.error && (
        <p class="st-error" role="alert" data-testid="composer-error">
          {state.error}
        </p>
      )}
    </form>
  );
}
