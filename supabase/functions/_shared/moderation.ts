/**
 * Moderation step, behind an interface so the implementation can change
 * (the obscenity-based moderator arrives in M4; an AI moderation API could be
 * plugged in later) without touching the request handler.
 */
export interface ModerationRequest {
  readonly text: string;
  readonly userId: string;
}

export type ModerationResult =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly reason: string };

export interface Moderator {
  check(request: ModerationRequest): Promise<ModerationResult>;
}

/** Placeholder until M4: lets everything through (input validation still applies). */
export const allowAllModerator: Moderator = {
  check: () => Promise.resolve({ allowed: true }),
};
