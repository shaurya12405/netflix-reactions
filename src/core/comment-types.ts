/** Shapes shared by the comment logic and UI. Kept free of DOM/browser APIs. */
export interface Comment {
  readonly id: string;
  readonly videoId: string;
  readonly tsSeconds: number;
  readonly userId: string;
  readonly parentId: string | null;
  readonly text: string;
  readonly isSpoiler: boolean;
  readonly likeCount: number;
  /** ISO timestamp. */
  readonly createdAt: string;
}

export interface CommentThread {
  readonly comment: Comment;
  readonly replies: readonly Comment[];
}
