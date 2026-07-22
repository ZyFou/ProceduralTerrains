import { describe, expect, it } from 'vitest';
import {
  EDITOR_SHORTCUTS,
  isMacPlatform,
  matchesShortcut,
  shortcutText,
} from '../src/keyboardShortcuts.js';

const keyEvent = (key, overrides = {}) => ({
  key,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  altKey: false,
  ...overrides,
});

describe('editor keyboard shortcuts', () => {
  it('detects Apple platforms and formats accessible platform labels', () => {
    expect(isMacPlatform('MacIntel')).toBe(true);
    expect(isMacPlatform('Win32')).toBe(false);
    expect(shortcutText(EDITOR_SHORTCUTS.save, 'MacIntel')).toBe('Command + S');
    expect(shortcutText(EDITOR_SHORTCUTS.save, 'Win32')).toBe('Ctrl + S');
    expect(shortcutText(EDITOR_SHORTCUTS.projects, 'Win32')).toBe('Ctrl + Shift + O');
  });

  it('uses Command on macOS and Ctrl on Windows', () => {
    expect(matchesShortcut(keyEvent('s', { metaKey: true }), EDITOR_SHORTCUTS.save, 'MacIntel')).toBe(true);
    expect(matchesShortcut(keyEvent('s', { ctrlKey: true }), EDITOR_SHORTCUTS.save, 'MacIntel')).toBe(false);
    expect(matchesShortcut(keyEvent('s', { ctrlKey: true }), EDITOR_SHORTCUTS.save, 'Win32')).toBe(true);
    expect(matchesShortcut(keyEvent('s', { metaKey: true }), EDITOR_SHORTCUTS.save, 'Win32')).toBe(false);
  });

  it('requires the declared secondary modifiers and exact key', () => {
    expect(matchesShortcut(keyEvent('o', { ctrlKey: true, shiftKey: true }), EDITOR_SHORTCUTS.projects, 'Win32')).toBe(true);
    expect(matchesShortcut(keyEvent('o', { ctrlKey: true }), EDITOR_SHORTCUTS.projects, 'Win32')).toBe(false);
    expect(matchesShortcut(keyEvent('p', { ctrlKey: true }), EDITOR_SHORTCUTS.paintMode, 'Win32')).toBe(true);
    expect(matchesShortcut(keyEvent('r', { ctrlKey: true }), EDITOR_SHORTCUTS.paintMode, 'Win32')).toBe(false);
  });
});
