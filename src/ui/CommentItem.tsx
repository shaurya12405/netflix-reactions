import { useState } from 'preact/hooks';
import type { Comment, CommentThread } from '../core/comment-types';
import { formatTimestamp } from '../core/time-format';

const AVATAR_COLORS = ['#8FA6FF', '#F0B072', '#6FD1AE', '#D3A2F0', '#F497A3', '#7FC8F8'];

function colorFor(userId: string): string {
  let h = 0;
  for (let i = 0; i < userId.length; i++) h = (h * 31 + userId.charCodeAt(i)) | 0;
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length]!;
}

interface ItemProps {
  readonly comment: Comment;
  readonly name: string;
  readonly isOwn: boolean;
  readonly isReply?: boolean;
}

function CommentBody({ comment }: { comment: Comment }) {
  const [revealed, setRevealed] = useState(false);
  if (comment.isSpoiler && !revealed) {
    return (
      <button
        type="button"
        class="st-spoiler"
        onClick={() => setRevealed(true)}
        aria-label="Spoiler. Click to reveal"
        data-testid="spoiler"
      >
        <span class="st-spoiler-text" aria-hidden="true">
          {comment.text}
        </span>
        <span class="st-spoiler-label">Spoiler · click to reveal</span>
      </button>
    );
  }
  return <p class="st-text">{comment.text}</p>;
}

export function CommentItem({ comment, name, isOwn, isReply = false }: ItemProps) {
  return (
    <article
      class={isReply ? 'st-comment st-reply' : 'st-comment'}
      data-testid="comment"
      data-comment-id={comment.id}
      data-ts={comment.tsSeconds}
    >
      <span class="st-avatar" style={{ background: colorFor(comment.userId) }} aria-hidden="true">
        {name.charAt(0).toUpperCase()}
      </span>
      <div class="st-comment-main">
        <div class="st-meta">
          <span class="st-name">{name}</span>
          {isOwn && <span class="st-you">you</span>}
          <span class="st-ts">{formatTimestamp(comment.tsSeconds)}</span>
        </div>
        <CommentBody comment={comment} />
      </div>
    </article>
  );
}

export function ThreadItem({
  thread,
  nameOf,
  viewerId,
}: {
  thread: CommentThread;
  nameOf: (userId: string) => string;
  viewerId: string | null;
}) {
  return (
    <div class="st-thread">
      <CommentItem comment={thread.comment} name={nameOf(thread.comment.userId)} isOwn={thread.comment.userId === viewerId} />
      {thread.replies.map((r) => (
        <CommentItem key={r.id} comment={r} name={nameOf(r.userId)} isOwn={r.userId === viewerId} isReply />
      ))}
    </div>
  );
}
