/**
 * Typed messages between the content script / popup and the background.
 * Uses the sendResponse + `return true` pattern, which works in both Chrome
 * and Firefox.
 */
import { browser } from 'wxt/browser';
import type { ConnectivityReport } from './connectivity';

export interface MessageMap {
  'probe-connectivity': { request: void; response: ConnectivityReport | { error: string } };
}

export type MessageType = keyof MessageMap;

interface Envelope<T extends MessageType = MessageType> {
  readonly type: T;
  readonly payload: MessageMap[T]['request'];
}

export function sendMessage<T extends MessageType>(
  type: T,
  payload: MessageMap[T]['request'],
): Promise<MessageMap[T]['response']> {
  const envelope: Envelope<T> = { type, payload };
  return browser.runtime.sendMessage(envelope) as Promise<MessageMap[T]['response']>;
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
    const handler = handlers[msg.type] as ((p: unknown) => Promise<unknown>) | undefined;
    if (!handler) return false;
    handler(msg.payload).then(sendResponse, (e: unknown) =>
      sendResponse({ error: e instanceof Error ? e.message : String(e) }),
    );
    return true;
  });
}
