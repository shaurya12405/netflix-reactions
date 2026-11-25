import { describe, expect, it, vi } from 'vitest';
import {
  createPostCommentHandler,
  type CommentRow,
  type InsertResult,
  type NewCommentRow,
  type PostCommentDeps,
} from '../../supabase/functions/post-comment/handler.ts';

const USER = '00000000-0000-4000-8000-00000000000a';
const PARENT = '10000000-0000-4000-8000-000000000001';

function setup(overrides: Partial<PostCommentDeps> = {}) {
  const inserted: NewCommentRow[] = [];
  const deps: PostCommentDeps = {
    getUserId: vi.fn(async (token: string) => (token === 'good-token' ? USER : null)),
    findComment: vi.fn(async (id: string) => (id === PARENT ? { videoId: 'netflix:1', parentId: null } : null)),
    insertComment: vi.fn(async (row: NewCommentRow): Promise<InsertResult> => {
      inserted.push(row);
      const comment: CommentRow = { id: 'new-id', like_count: 0, created_at: '2026-11-25T10:00:00Z', ...row };
      return { ok: true, comment };
    }),
    moderator: { check: vi.fn(async () => ({ allowed: true as const })) },
    ...overrides,
  };
  return { handler: createPostCommentHandler(deps), deps, inserted };
}

const post = (body: unknown, token: string | null = 'good-token', method = 'POST'): Request =>
  new Request('https://x.supabase.co/functions/v1/post-comment', {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: method === 'POST' ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined,
  });

const body = { videoId: 'netflix:1', tsSeconds: 42, text: 'Great scene', isSpoiler: false };

describe('post-comment handler', () => {
  it('answers CORS preflight', async () => {
    const { handler } = setup();
    const res = await handler(post(null, null, 'OPTIONS'));
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });

  it('rejects other methods', async () => {
    expect((await setup().handler(post(null, 'good-token', 'GET'))).status).toBe(405);
  });

  it('requires a token, and a valid one', async () => {
    expect((await setup().handler(post(body, null))).status).toBe(401);
    expect((await setup().handler(post(body, 'forged'))).status).toBe(401);
  });

  it('inserts with the user ID from the JWT, never from the body', async () => {
    const { handler, inserted } = setup();
    const res = await handler(post({ ...body, userId: 'attacker', user_id: 'attacker' }));
    expect(res.status).toBe(201);
    expect(inserted).toEqual([
      { video_id: 'netflix:1', ts_seconds: 42, user_id: USER, parent_id: null, text: 'Great scene', is_spoiler: false },
    ]);
    expect((await res.json()).comment.id).toBe('new-id');
  });

  it('rejects invalid JSON and invalid input without inserting', async () => {
    const { handler, inserted } = setup();
    expect((await handler(post('{nope'))).status).toBe(400);
    expect((await handler(post({ ...body, tsSeconds: -5 }))).status).toBe(400);
    expect((await handler(post({ ...body, videoId: 'bad id' }))).status).toBe(400);
    expect((await handler(post({ ...body, text: 'x'.repeat(201) }))).status).toBe(400);
    expect(inserted).toEqual([]);
  });

  it('checks that a reply’s parent exists, is top-level and on the same video', async () => {
    const missing = setup();
    expect((await missing.handler(post({ ...body, parentId: '10000000-0000-4000-8000-0000000000ff' }))).status).toBe(404);

    const nested = setup({ findComment: async () => ({ videoId: 'netflix:1', parentId: 'something' }) });
    expect((await nested.handler(post({ ...body, parentId: PARENT }))).status).toBe(400);

    const otherVideo = setup({ findComment: async () => ({ videoId: 'netflix:2', parentId: null }) });
    expect((await otherVideo.handler(post({ ...body, parentId: PARENT }))).status).toBe(400);

    const ok = setup();
    expect((await ok.handler(post({ ...body, parentId: PARENT }))).status).toBe(201);
    expect(ok.inserted[0]?.parent_id).toBe(PARENT);
  });

  it('stops at moderation', async () => {
    const { handler, inserted } = setup({
      moderator: { check: async () => ({ allowed: false as const, reason: 'Please keep it friendly.' }) },
    });
    const res = await handler(post(body));
    expect(res.status).toBe(422);
    expect((await res.json()).error).toBe('Please keep it friendly.');
    expect(inserted).toEqual([]);
  });

  it.each([
    ['ST429', 429],
    ['23503', 409],
    ['ST400', 400],
    ['ST404', 404],
    ['XX000', 500],
  ])('maps database error %s to HTTP %i', async (code, status) => {
    const log = vi.fn();
    const { handler } = setup({ insertComment: async () => ({ ok: false, code, message: 'db says no' }), log });
    expect((await handler(post(body))).status).toBe(status);
    expect(log).toHaveBeenCalledTimes(status === 500 ? 1 : 0);
  });
});
