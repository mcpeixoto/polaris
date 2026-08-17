import { describe, expect, it } from 'vitest';

import {
  chordFromEvent,
  chordId,
  chordsEqual,
  formatChord,
  formatChords,
  formatKeySpec,
  isModifierChord,
  parseKeySpec,
  SequenceMatcher,
} from './matcher';
import type { Chord, KeyboardEventLike } from './types';

/** A keystroke, as the browser would report it. */
function press(key: string, mods: Partial<Omit<KeyboardEventLike, 'key'>> = {}): KeyboardEventLike {
  return {
    key,
    ctrlKey: mods.ctrlKey ?? false,
    metaKey: mods.metaKey ?? false,
    shiftKey: mods.shiftKey ?? false,
    altKey: mods.altKey ?? false,
    ...(mods.code === undefined ? {} : { code: mods.code }),
  };
}

function one(spec: string, platform: 'mac' | 'other' = 'other'): Chord {
  const chords = parseKeySpec(spec, platform);
  const chord = chords[0];
  if (chord === undefined) throw new Error(`spec "${spec}" parsed to nothing`);
  return chord;
}

describe('parseKeySpec', () => {
  it('resolves mod to Command on Apple platforms and Control everywhere else', () => {
    const mac = one('mod+k', 'mac');
    expect(mac.meta, 'mod must be Command on a Mac or every shortcut is wrong there').toBe(true);
    expect(mac.ctrl, 'mod on a Mac must NOT also claim Control').toBe(false);

    const other = one('mod+k', 'other');
    expect(other.ctrl, 'mod must be Control off Apple platforms').toBe(true);
    expect(other.meta, 'mod off a Mac must NOT claim the Windows key').toBe(false);
  });

  it('splits a sequence on whitespace so g i is two chords', () => {
    const chords = parseKeySpec('g i', 'other');
    expect(chords, 'a sequence must parse to one chord per keystroke').toHaveLength(2);
    expect(chords.map((c) => c.key)).toEqual(['g', 'i']);
    expect(
      chords.every((c) => !c.ctrl && !c.meta && !c.alt && !c.shift),
      'a bare sequence must not pick up modifiers',
    ).toBe(true);
  });

  const cases: ReadonlyArray<{
    readonly spec: string;
    readonly key: string;
    readonly ctrl?: boolean;
    readonly meta?: boolean;
    readonly shift?: boolean;
    readonly alt?: boolean;
    readonly why: string;
  }> = [
    { spec: 'k', key: 'k', why: 'a plain letter is a chord with no modifiers' },
    { spec: 'K', key: 'k', why: 'shortcuts are written uppercase but mean the unshifted key' },
    { spec: '?', key: '?', why: 'punctuation is bound as the character it types' },
    { spec: 'Escape', key: 'Escape', why: 'DOM key names are accepted verbatim' },
    { spec: 'esc', key: 'Escape', why: 'the everyday spelling must not silently miss' },
    { spec: 'ArrowUp', key: 'ArrowUp', why: 'arrows keep their DOM names' },
    { spec: 'up', key: 'ArrowUp', why: 'the short spelling is the one people write' },
    {
      spec: 'space',
      key: 'Space',
      why: 'a literal space is the sequence separator, so it needs a name',
    },
    { spec: 'f5', key: 'F5', why: 'function keys are case-insensitive' },
    { spec: 'shift+alt+p', key: 'p', shift: true, alt: true, why: 'modifiers stack in any order' },
    {
      spec: 'alt+shift+p',
      key: 'p',
      shift: true,
      alt: true,
      why: 'modifier order must not matter',
    },
    {
      spec: 'ctrl+shift+Enter',
      key: 'Enter',
      ctrl: true,
      shift: true,
      why: 'named keys combine with modifiers',
    },
    {
      spec: 'mod++',
      key: '+',
      ctrl: true,
      why: 'the plus key is written doubled, since + is the separator',
    },
    { spec: 'plus', key: '+', why: 'the alias exists for keymaps that prefer to spell it' },
  ];

  for (const c of cases) {
    it(`parses "${c.spec}" — ${c.why}`, () => {
      const chord = one(c.spec, 'other');
      expect(chord.key, c.why).toBe(c.key);
      expect(chord.ctrl, `ctrl for "${c.spec}"`).toBe(c.ctrl ?? false);
      expect(chord.meta, `meta for "${c.spec}"`).toBe(c.meta ?? false);
      expect(chord.shift, `shift for "${c.spec}"`).toBe(c.shift ?? false);
      expect(chord.alt, `alt for "${c.spec}"`).toBe(c.alt ?? false);
    });
  }

  const rejected: ReadonlyArray<{ readonly spec: string; readonly why: string }> = [
    { spec: '', why: 'an empty spec is a missing binding, not a valid one' },
    { spec: '   ', why: 'whitespace is a separator, so a spec of only whitespace binds nothing' },
    { spec: 'mod+', why: 'a dangling separator is a slip and must not silently bind Control+Plus' },
    { spec: 'mod+k+j', why: 'a chord has one key; two means the author meant a sequence' },
    { spec: 'excape', why: 'a misspelt key name would never fire and must fail at startup' },
  ];

  for (const r of rejected) {
    it(`rejects "${r.spec}" — ${r.why}`, () => {
      expect(() => parseKeySpec(r.spec, 'other'), r.why).toThrow();
    });
  }
});

describe('chordFromEvent', () => {
  it('lowercases the letter and keeps Shift as a modifier', () => {
    const chord = chordFromEvent(press('K', { shiftKey: true, code: 'KeyK' }));
    expect(chord.key, 'case is carried by the shift flag, not by the key').toBe('k');
    expect(chord.shift).toBe(true);
    expect(chord.code, 'the physical key is kept for layouts that mangle the logical one').toBe(
      'KeyK',
    );
  });

  it('names the space bar so it cannot be confused with the sequence separator', () => {
    expect(chordFromEvent(press(' ')).key).toBe('Space');
  });

  it('recognises a press of a modifier alone', () => {
    expect(
      isModifierChord(chordFromEvent(press('Shift', { shiftKey: true }))),
      'reaching for Shift mid-sequence must not count as a chord',
    ).toBe(true);
    expect(isModifierChord(chordFromEvent(press('g')))).toBe(false);
  });
});

describe('chordsEqual', () => {
  it('matches a plain letter', () => {
    expect(chordsEqual(one('k'), chordFromEvent(press('k', { code: 'KeyK' })))).toBe(true);
  });

  it('treats Shift as significant on letters', () => {
    expect(
      chordsEqual(one('x'), chordFromEvent(press('X', { shiftKey: true, code: 'KeyX' }))),
      'X and ⇧X are different gestures; range-select must not fire plain select',
    ).toBe(false);
  });

  it('treats Shift as significant on named keys', () => {
    expect(
      chordsEqual(one('ArrowUp'), chordFromEvent(press('ArrowUp', { shiftKey: true }))),
      '⇧↑ range-selects and ↑ moves; they must not collide',
    ).toBe(false);
    expect(
      chordsEqual(one('shift+ArrowUp'), chordFromEvent(press('ArrowUp', { shiftKey: true }))),
    ).toBe(true);
  });

  it('ignores Shift on punctuation, because the layout decides it', () => {
    expect(
      chordsEqual(one('?'), chordFromEvent(press('?', { shiftKey: true, code: 'Slash' }))),
      '? is Shift+/ on a US keyboard and unshifted elsewhere; the binding means the character',
    ).toBe(true);
  });

  it('falls back to the physical key when Alt composed a character', () => {
    const composed = chordFromEvent(press('π', { altKey: true, code: 'KeyP' }));
    expect(
      chordsEqual(one('alt+p', 'mac'), composed),
      'Alt+P arrives as π on a Mac; only the code still says which key was struck',
    ).toBe(true);
    expect(
      chordsEqual(one('shift+alt+p', 'mac'), composed),
      'the composed character must not swallow the Shift distinction',
    ).toBe(false);
  });

  it('does not second-guess a layout that produced a plain letter', () => {
    expect(
      chordsEqual(one('k'), chordFromEvent(press('v', { code: 'KeyK' }))),
      'a Dvorak user pressing the key that types v means v, not the QWERTY cap',
    ).toBe(false);
  });

  it('gives colliding specs the same identity, so the registry can reject them', () => {
    expect(
      chordId(one('shift+/')),
      'if the matcher cannot tell / from ⇧/ then the registry must call them one binding',
    ).toBe(chordId(one('/')));
    expect(chordId(one('mod+k', 'mac'))).not.toBe(chordId(one('mod+k', 'other')));
  });
});

describe('formatChord', () => {
  const cases: ReadonlyArray<{
    readonly spec: string;
    readonly mac: string;
    readonly other: string;
  }> = [
    { spec: 'mod+k', mac: '⌘K', other: 'Ctrl+K' },
    { spec: 'shift+alt+p', mac: '⌥⇧P', other: 'Alt+Shift+P' },
    { spec: 'mod+Enter', mac: '⌘⏎', other: 'Ctrl+Enter' },
    { spec: 'Escape', mac: 'Esc', other: 'Esc' },
    { spec: 'ArrowUp', mac: '↑', other: '↑' },
    { spec: '?', mac: '?', other: '?' },
  ];

  for (const c of cases) {
    it(`draws "${c.spec}" as ${c.mac} on a Mac and ${c.other} elsewhere`, () => {
      expect(
        formatChord(one(c.spec, 'mac'), 'mac'),
        'the help overlay must speak Mac on a Mac',
      ).toBe(c.mac);
      expect(
        formatChord(one(c.spec, 'other'), 'other'),
        'a hardcoded ⌘ would be a lie on Windows',
      ).toBe(c.other);
    });
  }

  it('draws a sequence as its chords in order', () => {
    expect(formatChords(parseKeySpec('g i', 'other'), 'other')).toBe('G I');
    expect(formatKeySpec('g m', 'mac')).toBe('G M');
  });
});

describe('SequenceMatcher', () => {
  const bindings = [
    { id: 'nav.goToIssues', chords: parseKeySpec('g i', 'other') },
    { id: 'nav.goToMyIssues', chords: parseKeySpec('g m', 'other') },
    { id: 'command.open', chords: parseKeySpec('mod+k', 'other') },
    { id: 'issue.select', chords: parseKeySpec('x', 'other') },
  ];

  const g = chordFromEvent(press('g', { code: 'KeyG' }));
  const i = chordFromEvent(press('i', { code: 'KeyI' }));
  const x = chordFromEvent(press('x', { code: 'KeyX' }));
  const q = chordFromEvent(press('q', { code: 'KeyQ' }));

  it('matches a single chord immediately', () => {
    const matcher = new SequenceMatcher();
    const result = matcher.feed(
      chordFromEvent(press('k', { ctrlKey: true, code: 'KeyK' })),
      bindings,
    );
    expect(result.type).toBe('match');
    if (result.type === 'match') expect(result.id).toBe('command.open');
  });

  it('reports a prefix as pending and then fires the sequence', () => {
    const matcher = new SequenceMatcher();
    const first = matcher.feed(g, bindings, 0);
    expect(first.type, 'g on its way to g i is consumed, not passed to the page').toBe('pending');
    const second = matcher.feed(i, bindings, 200);
    expect(second.type).toBe('match');
    if (second.type === 'match') expect(second.id).toBe('nav.goToIssues');
    expect(matcher.pending, 'a completed sequence must leave no state behind').toHaveLength(0);
  });

  it('forgets a half-typed sequence after a second', () => {
    const matcher = new SequenceMatcher();
    matcher.feed(g, bindings, 0);
    const late = matcher.feed(i, bindings, 1100);
    expect(
      late.type,
      'a g typed a second ago is a forgotten keystroke, not the start of the i the user just typed',
    ).toBe('none');
  });

  it('keeps a sequence alive right up to the timeout', () => {
    const matcher = new SequenceMatcher();
    matcher.feed(g, bindings, 0);
    expect(matcher.feed(i, bindings, 1000).type, 'the timeout must not fire early').toBe('match');
  });

  it('resets cleanly when the sequence goes nowhere', () => {
    const matcher = new SequenceMatcher();
    matcher.feed(g, bindings, 0);
    const dead = matcher.feed(q, bindings, 10);
    expect(dead.type, 'g then an unbound key is nothing at all').toBe('none');
    expect(matcher.pending, 'the dead prefix must not linger').toHaveLength(0);

    matcher.feed(g, bindings, 20);
    const revived = matcher.feed(i, bindings, 30);
    expect(revived.type, 'a failed sequence must not poison the next one').toBe('match');
  });

  it('lets the keystroke that killed a prefix still fire on its own', () => {
    const matcher = new SequenceMatcher();
    matcher.feed(g, bindings, 0);
    const result = matcher.feed(x, bindings, 10);
    expect(result.type, 'a dead prefix must not eat the key that killed it').toBe('match');
    if (result.type === 'match') expect(result.id).toBe('issue.select');
  });

  it('is bounded by the bindings it is given, not by the ones it saw before', () => {
    const matcher = new SequenceMatcher();
    matcher.feed(g, bindings, 0);
    const narrowed = matcher.feed(
      i,
      bindings.filter((b) => b.id === 'command.open'),
      10,
    );
    expect(narrowed.type, 'a context change between chords must not complete a sequence').toBe(
      'none',
    );
  });
});
