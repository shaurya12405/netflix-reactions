import { describe, expect, it } from 'vitest';
import { isComposeHotkey, isTypingTarget } from '../../src/core/hotkeys';

const key = (k: string, mods: Partial<{ ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean; repeat: boolean }> = {}) => ({
  key: k,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  repeat: false,
  ...mods,
});

describe('isTypingTarget', () => {
  it.each([
    [{ tagName: 'INPUT' }, true],
    [{ tagName: 'input', type: 'search' }, true],
    [{ tagName: 'INPUT', type: 'checkbox' }, false],
    [{ tagName: 'INPUT', type: 'button' }, false],
    [{ tagName: 'TEXTAREA' }, true],
    [{ tagName: 'SELECT' }, true],
    [{ tagName: 'DIV', isContentEditable: true }, true],
    [{ tagName: 'DIV' }, false],
    [{ tagName: 'VIDEO' }, false],
  ])('%j -> %s', (el, expected) => {
    expect(isTypingTarget(el)).toBe(expected);
  });

  it('handles a missing target', () => {
    expect(isTypingTarget(null)).toBe(false);
    expect(isTypingTarget(undefined)).toBe(false);
  });
});

describe('isComposeHotkey', () => {
  it('accepts a plain c', () => expect(isComposeHotkey(key('c'))).toBe(true));
  it.each([
    ['C (shift)', key('C', { shiftKey: true })],
    ['ctrl+c (copy)', key('c', { ctrlKey: true })],
    ['cmd+c', key('c', { metaKey: true })],
    ['alt+c', key('c', { altKey: true })],
    ['auto-repeat', key('c', { repeat: true })],
    ['another key', key('x')],
  ])('rejects %s', (_label, e) => expect(isComposeHotkey(e)).toBe(false));
});
