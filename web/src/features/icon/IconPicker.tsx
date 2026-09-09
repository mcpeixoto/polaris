/**
 * The glyph and the colour a project, team or initiative is recognised by.
 *
 * Two properties rather than one, and they are chosen together because that is how they are
 * read: the sidebar draws the icon tinted with the colour, so picking a rocket and then
 * discovering it is the same grey as the four rows above it is a round trip nobody should
 * have to make. One popover, one value, `{icon, color}`.
 *
 * ## Two kinds of glyph, one column
 *
 * A stored icon is either an emoji — anything the reader's own font can draw — or a token
 * naming one of the line icons in `./glyphs`, written `icon:rocket`. The tabs at the top are
 * that distinction, and they are the whole reason this panel was rebuilt: an emoji is a
 * picture the platform owns, drawn in whatever colours Apple or Google chose, and a workspace
 * that wants its projects to read as a set cannot get one out of emoji. The line icons are
 * `currentColor` all the way down, so the colour beside them is not decoration — it is the
 * only thing that makes twenty projects in a sidebar distinguishable at 14px.
 *
 * Which tab opens is decided by what is already chosen, not by a default: a project drawn
 * with 🚀 opens on Emojis with 🚀 marked, and everything else opens on Icons. Landing on the
 * tab that does not contain your current value is a panel that says "nothing is chosen" about
 * a project that plainly has an icon.
 *
 * ## Two deliberate departures from the reference
 *
 * **The colour row stays on both tabs.** Linear hides it under Emojis, which is right for
 * Linear because there the colour belongs to the glyph. Here it belongs to the *entity*: it
 * is a column of its own, it survives a switch from an emoji to an icon, and the rail, the
 * board card and the breadcrumb all read it. Hiding the control on one tab would make a
 * stored property unreachable depending on which kind of glyph happened to be chosen.
 *
 * **The free-text field survives.** The grid is curated — 156 line icons and 120 emoji, no
 * icon library, no emoji keyboard, and `web/package.json` gains nothing — so the field is what
 * keeps that a shortcut rather than a limit. Anything a person can type or paste is a valid
 * icon, because the value is a string and the reader's own font draws it. The grid answers "I
 * want one"; the field answers "I want *that* one".
 *
 * ## The contract this panel keeps
 *
 * One change per act, and never a pair when only one half moved — see `IconPicker.test.tsx`.
 * A control that emitted its value on every keystroke of the field, or on every frame of a
 * drag on the native colour input, would put a mutation, a version and a change row on the
 * wire per character. The colour half is `components/ColorPicker`, reused rather than
 * restated: it already knows the sixteen swatches that clear 3:1 against both page colours,
 * and it already commits once per discrete act.
 */

import { useEffect, useRef, useState, type RefObject } from 'react';

import { ColorPicker, Input, Popover, Tabs, type TabItem } from '~/components';

import { EMOJI_GLYPHS, searchEmoji } from './emoji';
import { iconLabel, iconToken, iconTokenName, searchIconGlyphs } from './glyphs';
import styles from './IconPicker.module.css';

/** What a project, team or initiative is drawn as. Both halves are stored strings. */
export interface IconValue {
  readonly icon: string;
  readonly color: string;
}

export interface IconPickerProps {
  open: boolean;
  onClose: () => void;
  /** The control the panel belongs to: what it is positioned against, and where focus returns. */
  trigger: RefObject<HTMLElement | null>;
  value: IconValue;
  /**
   * Called once per choice — one glyph, or one colour, never both at once. The caller writes
   * whichever half changed; a control that emitted the pair on every keystroke of the free-text
   * field would put a mutation on the wire for every character of a pasted emoji.
   */
  onChange: (value: IconValue) => void;
  /** The id this panel's Escape is registered under. Unique across everything mounted at once. */
  actionId: string;
  /** The panel's accessible name. Names what is being drawn: "Project icon". */
  label?: string | undefined;
}

type Kind = 'icons' | 'emojis';

/**
 * The ten colours the dot row offers, out of `ColorPicker`'s sixteen.
 *
 * Named rather than labelled with their hex, because "#0891b2" announced by a screen reader
 * is not a colour anybody recognises — and because the full sixteen, with their hex names,
 * are one click away behind the last dot, which is the same `ColorPicker` every other surface
 * uses. Ten is the row Linear draws and it is also what fits at this width without wrapping.
 */
const DOTS: readonly { readonly name: string; readonly hex: string }[] = [
  { name: 'Grey', hex: '#64748b' },
  { name: 'Red', hex: '#ef4444' },
  { name: 'Orange', hex: '#ea580c' },
  { name: 'Amber', hex: '#d97706' },
  { name: 'Green', hex: '#16a34a' },
  { name: 'Teal', hex: '#0d9488' },
  { name: 'Cyan', hex: '#0891b2' },
  { name: 'Blue', hex: '#3b82f6' },
  { name: 'Indigo', hex: '#6366f1' },
  { name: 'Pink', hex: '#db2777' },
];

/**
 * Which tab a value opens on: the one that holds it.
 *
 * A token opens on Icons, an emoji opens on Emojis — and *nothing* opens on Emojis too,
 * which is the one case worth arguing. Linear defaults an empty picker to its icon grid.
 * This does not, because before this change the panel was an emoji grid and nothing else:
 * every icon in every existing workspace is an emoji, and moving the empty case to a new
 * grid would change where a control somebody uses weekly puts its first row. The line icons
 * are one click away, and they become the default for that project the moment it takes one.
 */
function kindOf(icon: string): Kind {
  return iconTokenName(icon) === null ? 'emojis' : 'icons';
}

export function IconPicker({
  open,
  onClose,
  trigger,
  value,
  onChange,
  actionId,
  label = 'Icon',
}: IconPickerProps) {
  // The field is uncontrolled between edits: it holds whatever is being typed, and only a
  // committed value reaches the caller. Seeded from the value each time the panel opens, the
  // same way the date box is, so a half-typed glyph is never overwritten by a delta.
  const fieldRef = useRef<HTMLInputElement | null>(null);

  const [kind, setKind] = useState<Kind>(() => kindOf(value.icon));
  const [query, setQuery] = useState('');

  // Reopening is a fresh question: the tab goes back to whichever one holds the current value
  // and the search box empties, rather than the panel reopening onto the four icons somebody
  // filtered down to last week. Keyed on `open` alone — a delta that changes the icon while
  // the panel is up must not yank the tab out from under the pointer.
  const wasOpen = useRef(open);
  useEffect(() => {
    if (open && !wasOpen.current) {
      setKind(kindOf(value.icon));
      setQuery('');
    }
    wasOpen.current = open;
  }, [open, value.icon]);

  const tabs: TabItem[] = [
    { id: 'icons', label: 'Icons' },
    { id: 'emojis', label: 'Emojis' },
  ];

  const glyphs = searchIconGlyphs(query);
  const emojis = searchEmoji(query);
  const empty = kind === 'icons' ? glyphs.length === 0 : emojis.length === 0;

  return (
    <Popover
      open={open}
      onClose={onClose}
      trigger={trigger}
      label={label}
      actionId={actionId}
      actionTitle={`Close the ${label.toLowerCase()} picker`}
      className={styles.panel}
    >
      <Tabs
        items={tabs}
        aria-label={`${label}: kind of glyph`}
        value={kind}
        onSelect={(id) => {
          setKind(id as Kind);
          setQuery('');
        }}
        className={styles.tabs}
      />

      {/* The colour is one row of dots and then the whole palette, in that order: the ten
          answers somebody wants, and the sixteen-swatch picker with its hex field for the
          workspace that has its own. */}
      <div className={styles.colors} role="group" aria-label={`${label}: colour`}>
        {DOTS.map((dot) => (
          <button
            key={dot.hex}
            type="button"
            className={styles.dot}
            // Inline because a colour is workspace data, not paint a theme may restyle —
            // the same reason ColorPicker's own swatches are inline. See its header.
            style={{ backgroundColor: dot.hex }}
            aria-label={dot.name}
            aria-pressed={dot.hex.toLowerCase() === value.color.toLowerCase()}
            onClick={() => onChange({ icon: value.icon, color: dot.hex })}
          />
        ))}
        <span className={styles.divider} aria-hidden="true" />
        <ColorPicker
          compact
          className={styles.custom}
          label={`${label} colour`}
          value={value.color}
          onChange={(color) => onChange({ icon: value.icon, color })}
        />
      </div>

      <Input
        label={kind === 'icons' ? 'Search icons' : 'Search emojis'}
        hideLabel
        surface="bare"
        className={styles.search}
        placeholder={kind === 'icons' ? 'Search icons…' : 'Search emojis…'}
        value={query}
        autoComplete="off"
        spellCheck={false}
        onChange={(event) => setQuery(event.target.value)}
      />

      {empty ? (
        <p className={styles.empty} role="status">
          {kind === 'icons'
            ? `No icon matches “${query.trim()}”. Try a word for what it is: rocket, money, ship.`
            : `No emoji matches “${query.trim()}”. Any emoji you can type is a valid icon — the field below takes it.`}
        </p>
      ) : (
        <div
          className={styles.grid}
          role="group"
          aria-label={kind === 'icons' ? 'Icons' : 'Emojis'}
        >
          {kind === 'icons'
            ? glyphs.map((glyph) => {
                const token = iconToken(glyph.name);
                return (
                  <button
                    key={glyph.name}
                    type="button"
                    className={styles.cell}
                    aria-label={iconLabel(glyph.name)}
                    aria-pressed={token === value.icon}
                    onClick={() => onChange({ icon: token, color: value.color })}
                  >
                    <svg
                      viewBox="0 0 16 16"
                      aria-hidden="true"
                      fill="none"
                      // The chosen colour, on the glyph itself: what this icon will look like
                      // in the row it is being chosen for, rather than a preview somewhere else.
                      stroke={value.color === '' ? 'currentColor' : value.color}
                      strokeWidth={1.5}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d={glyph.path} />
                    </svg>
                  </button>
                );
              })
            : emojis.map((entry) => (
                <button
                  key={entry.glyph}
                  type="button"
                  className={styles.cell}
                  // The glyph itself is the label. A screen reader reads the emoji's own name,
                  // which is the only name for it anybody agrees on.
                  aria-label={entry.glyph}
                  aria-pressed={entry.glyph === value.icon}
                  onClick={() => onChange({ icon: entry.glyph, color: value.color })}
                >
                  <span aria-hidden="true">{entry.glyph}</span>
                </button>
              ))}
        </div>
      )}

      {kind === 'emojis' ? (
        /* A form so that Enter commits, for the same reason the date box is one: the keymap
           lint refuses a local key handler, and submitting is the platform's own answer. */
        <form
          className={styles.customIcon}
          onSubmit={(event) => {
            event.preventDefault();
            const typed = fieldRef.current?.value.trim() ?? '';
            if (typed === '') return;
            // One glyph, not a word. Somebody pasting a sentence has pasted the wrong thing,
            // and a sidebar row is not the place to find that out.
            onChange({ icon: [...typed][0] ?? '', color: value.color });
          }}
        >
          <Input
            ref={fieldRef}
            label="Or any emoji"
            defaultValue={iconTokenName(value.icon) === null ? value.icon : ''}
            autoComplete="off"
            maxLength={8}
          />
        </form>
      ) : null}
    </Popover>
  );
}

/** Everything the grid can draw, for the surfaces that read a stored value back. */
export { EMOJI_GLYPHS };
