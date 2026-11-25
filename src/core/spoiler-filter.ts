/**
 * Spoiler gating: which comments a viewer may see right now.
 *
 * A comment is visible only if its timestamp lies inside a range the viewer
 * has actually watched. Seeking back keeps earlier comments visible (they are
 * still inside watched ranges); seeking forward over unwatched footage does
 * not reveal anything from the skipped part. A viewer always sees their own
 * comments. A reply additionally needs its parent to be visible, so a reply
 * written later in the episode never leaks under an early comment.
 */
import type { Comment, CommentThread } from './comment-types';
import { isWatched, type WatchedRanges } from './watched-ranges';

export function isCommentVisible(comment: Comment, ranges: WatchedRanges, viewerId: string | null): boolean {
  return (viewerId !== null && comment.userId === viewerId) || isWatched(ranges, comment.tsSeconds);
}

const byTimestamp = (a: Comment, b: Comment): number =>
  a.tsSeconds - b.tsSeconds || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);

/** Visible top-level comments with their visible replies, both in timestamp order. */
export function visibleThreads(
  comments: Iterable<Comment>,
  ranges: WatchedRanges,
  viewerId: string | null,
): CommentThread[] {
  const tops: Comment[] = [];
  const replies = new Map<string, Comment[]>();
  for (const c of comments) {
    if (!isCommentVisible(c, ranges, viewerId)) continue;
    if (c.parentId === null) {
      tops.push(c);
    } else {
      const list = replies.get(c.parentId);
      if (list) list.push(c);
      else replies.set(c.parentId, [c]);
    }
  }
  tops.sort(byTimestamp);
  return tops.map((comment) => ({
    comment,
    replies: (replies.get(comment.id) ?? []).sort(byTimestamp),
  }));
}

/**
 * Comments whose moment playback has just reached: timestamps in (from, to],
 * from one continuous playback step. Drives pop-up mode. Top-level only, and
 * never spoilers (those stay blurred in the panel rather than flashing up).
 */
export function crossedComments(comments: Iterable<Comment>, from: number, to: number): Comment[] {
  const out: Comment[] = [];
  for (const c of comments) {
    if (c.parentId === null && !c.isSpoiler && c.tsSeconds > from && c.tsSeconds <= to) out.push(c);
  }
  return out.sort(byTimestamp);
}
