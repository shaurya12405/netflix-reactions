/**
 * Typed messages between the content script / popup and the background.
 * Uses the sendResponse + `return true` pattern, which works in both Chrome
 * and Firefox.
 */
import { browser } from 'wxt/browser';
import type { ActionResult, AuthState } from '../background/auth';
import type { PostCommentRequest, PostCommentResponse } from '../background/comments';

type Failure = { error: string };

export interface MessageMap {
  'auth:get-state': { request: void; response: AuthState | Failure };
  'auth:sign-in': { request: void; response: ActionResult };
  'auth:sign-out': { request: void; response: ActionResult };
  'auth:set-display-name': { request: { displayName: string }; response: ActionResult };
  'auth:get-redirect-url': { request: void; response: string };
  'comments:post': { request: PostCommentRequest; response: PostCommentResponse };
}

export type MessageType = keyof MessageMap;

/**
 * Messages that change the account may only come from our own extension pages
 * (popup, settings), never from a content script running inside a web page.
 */
const EXTENSION_PAGE_ONLY: ReadonlySet<MessageType> = new Set([
  'auth:sign-in',
  'auth:sign-out',
  'auth:set-display-name',
]);

interface Envelope<T extends MessageType = MessageType> {
  readonly type: T;
  readonly payload: MessageMap[T]['request'];
}

export function sendMessage<T extends MessageType>(
  type: T,
  payload: MessageMap[T]['request'],
): Promise<MessageMap[T]['response']> {
  const envelope: Envelope<T> = { type, payload };
  return (browser.runtime.sendMessage(envelope) as Promise<MessageMap[T]['response'] | undefined>).then(
    (response) => {
      if (response === undefined) throw new Error(`No response to "${type}" (message rejected or no handler).`);
      return response;
    },
  );
}

/** True if the message was sent by one of our extension pages (not a web page). */
function isFromExtensionPage(senderUrl: string | undefined): boolean {
  return typeof senderUrl === 'string' && senderUrl.startsWith(browser.runtime.getURL('/'));
}

export type Handlers = {
  [T in MessageType]: (payload: MessageMap[T]['request']) => Promise<MessageMap[T]['response']>;
};

function isEnvelope(msg: unknown): msg is Envelope {
  return typeof msg === 'object' && msg !== null && typeof (msg as Envelope).type === 'string';
}

export function listenForMessages(handlers: Handlers): void {
  browser.runtime.onMessage.addListener((msg: unknown, sender, sendResponse) => {
    // Only accept messages from our own extension.
    if (sender.id !== browser.runtime.id || !isEnvelope(msg)) return false;
    if (EXTENSION_PAGE_ONLY.has(msg.type) && !isFromExtensionPage(sender.url)) return false;
    const handler = handlers[msg.type] as ((p: unknown) => Promise<unknown>) | undefined;
    if (!handler) return false;
    handler(msg.payload).then(sendResponse, (e: unknown) =>
      sendResponse({ ok: false, error: e instanceof Error ? e.message : String(e) }),
    );
    return true;
  });
}
