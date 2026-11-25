import { describe, expect, it } from 'vitest';
import { isCommentRow, rowToComment } from '../../src/services/comment-mapping';
import { parseDisplayMode } from '../../src/services/settings';

describe('parseDisplayMode', () => {
  it('keeps valid modes and falls back to the panel', () => {
    expect(parseDisplayMode('popups')).toBe('popups');
    expect(parseDisplayMode('hidden')).toBe('hidden');
    expect(parseDisplayMode(undefined)).toBe('panel');
    expect(parseDisplayMode('fullscreen')).toBe('panel');
  });
});

describe('rowToComment', () => {
  it('maps database rows, including numeric strings from Realtime', () => {
    const row = {
      id: 'x', video_id: 'netflix:1', ts_seconds: '12.500', user_id: 'u', parent_id: null,
      text: 'hi', is_spoiler: true, like_count: '3', created_at: '2026-11-25T10:00:00Z',
    };
    expect(isCommentRow(row)).toBe(true);
    expect(rowToComment(row)).toEqual({
      id: 'x', videoId: 'netflix:1', tsSeconds: 12.5, userId: 'u', parentId: null,
      text: 'hi', isSpoiler: true, likeCount: 3, createdAt: '2026-11-25T10:00:00Z',
    });
  });

  it('rejects malformed Realtime payloads', () => {
    expect(isCommentRow(null)).toBe(false);
    expect(isCommentRow({ id: 1 })).toBe(false);
  });
});
