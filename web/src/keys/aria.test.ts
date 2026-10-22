import { describe, expect, it } from 'vitest';

import { ariaKeyShortcuts } from './aria';

/**
 * These assertions are about a spelling, not a behaviour, which is why they are worth
 * writing: nothing at runtime reads `aria-keyshortcuts` back, so a wrong modifier name is
 * invisible everywhere except in a screen reader, where it is announced as a shortcut that
 * does not exist.
 */
describe('ariaKeyShortcuts', () => {
  it('resolves mod to the platform modifier', () => {
    expect(ariaKeyShortcuts('mod+k', 'mac')).toBe('Meta+K');
    expect(ariaKeyShortcuts('mod+k', 'other')).toBe('Control+K');
  });

  it('names modifiers the way ARIA does, not the way the product draws them', () => {
    expect(ariaKeyShortcuts('ctrl+shift+k', 'other')).toBe('Control+Shift+K');
    expect(ariaKeyShortcuts('cmd+shift+p', 'other')).toBe('Shift+Meta+P');
    expect(ariaKeyShortcuts('opt+shift+up', 'mac')).toBe('Alt+Shift+ArrowUp');
  });

  it('orders modifiers before the key, consistently', () => {
    // The same chord written in three orders is one announcement.
    expect(ariaKeyShortcuts('shift+ctrl+alt+mod+s', 'mac')).toBe('Control+Alt+Shift+Meta+S');
    expect(ariaKeyShortcuts('mod+alt+shift+ctrl+s', 'mac')).toBe('Control+Alt+Shift+Meta+S');
    expect(ariaKeyShortcuts('alt+mod+ctrl+shift+s', 'mac')).toBe('Control+Alt+Shift+Meta+S');
  });

  it('uses key values for named keys', () => {
    expect(ariaKeyShortcuts('esc')).toBe('Escape');
    expect(ariaKeyShortcuts('enter')).toBe('Enter');
    expect(ariaKeyShortcuts('space')).toBe('Space');
    expect(ariaKeyShortcuts('pgdn')).toBe('PageDown');
    expect(ariaKeyShortcuts('f7')).toBe('F7');
  });

  it('capitalises a bare letter and leaves a digit alone', () => {
    expect(ariaKeyShortcuts('e')).toBe('E');
    expect(ariaKeyShortcuts('2')).toBe('2');
  });

  it('spells the plus key out, because the delimiter has taken the character', () => {
    expect(ariaKeyShortcuts('mod++', 'mac')).toBe('Meta+plus');
  });

  it('omits a multi-chord sequence rather than mis-stating it', () => {
    // `aria-keyshortcuts` is a list of alternatives, so `"G I"` would claim that either
    // key alone works. Saying nothing is the only honest answer.
    expect(ariaKeyShortcuts('g i')).toBeUndefined();
    expect(ariaKeyShortcuts('g mod+i')).toBeUndefined();
  });
});
