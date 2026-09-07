/**
 * The glyph and the colour a project, team or initiative is recognised by.
 *
 * Two properties rather than one, and they are chosen together because that is how they are
 * read: the sidebar draws the emoji tinted with the colour, so picking a rocket and then
 * discovering it is the same grey as the four rows above it is a round trip nobody should
 * have to make. One popover, one value, `{icon, color}`.
 *
 * ## Why the grid is curated and short
 *
 * There is no emoji library in this application and this file does not add one. A full
 * keyboard is a few thousand glyphs, a search index in every language the product ships, and
 * a dependency that ships its own font assets — for a control used a handful of times in the
 * life of a workspace. What people actually pick for a project is a small, boring set: a
 * shape for the kind of work, a symbol for the domain, an arrow for the direction. That set is
 * below, grouped so it can be scanned rather than read.
 *
 * The free-text field is what makes the grid a shortcut rather than a limit. Anything a person
 * can type or paste — an emoji their platform has and this list does not, a flag, a letter —
 * is a valid icon, because the value is stored as a string and rendered by the reader's own
 * font. The grid is the answer to "I want one", the field is the answer to "I want *that* one".
 *
 * The colour is `components/ColorPicker`, reused rather than restated. It already knows the
 * two things this control would otherwise have got wrong: the sixteen swatches that clear 3:1
 * against both page colours, and committing once per discrete act instead of once per frame of
 * a drag on the native picker.
 */

import { useRef, type RefObject } from 'react';

import { ColorPicker, Input, Popover } from '~/components';

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
   * Called once per choice — one emoji, or one colour, never both at once. The caller writes
   * whichever half changed; a control that emitted the pair on every keystroke of the free-text
   * field would put a mutation on the wire for every character of a pasted emoji.
   */
  onChange: (value: IconValue) => void;
  /** The id this panel's Escape is registered under. Unique across everything mounted at once. */
  actionId: string;
  /** The panel's accessible name. Names what is being drawn: "Project icon". */
  label?: string | undefined;
}

/**
 * The offered glyphs, grouped by what somebody is looking for rather than by Unicode block.
 *
 * Every one of them renders as a single glyph on all three desktop platforms — no ZWJ
 * sequences, no skin tones, no flags. A sequence that a platform has not composed falls apart
 * into two or three characters at the exact size where it is smallest, which is a broken
 * sidebar row rather than a slightly wrong picture.
 */
const GROUPS: readonly { readonly name: string; readonly icons: readonly string[] }[] = [
  { name: 'Work', icons: ['🚀', '🎯', '🛠️', '⚙️', '🧩', '📦', '🗂️', '📝', '📊', '🔍'] },
  { name: 'Signals', icons: ['⭐', '🔥', '⚡', '💡', '🔔', '🚧', '🐛', '🩹', '🧪', '🧭'] },
  { name: 'Things', icons: ['🌍', '🌱', '🏗️', '🏛️', '🔐', '💳', '📱', '💻', '📡', '🎨'] },
  { name: 'Direction', icons: ['📈', '📉', '➡️', '🔁', '🏁', '🧱', '🪜', '🗺️', '⏱️', '🤝'] },
];

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
      {GROUPS.map((group) => (
        <div key={group.name} className={styles.group}>
          <h2 className={styles.heading}>{group.name}</h2>
          <div className={styles.grid} role="group" aria-label={group.name}>
            {group.icons.map((icon) => (
              <button
                key={icon}
                type="button"
                className={styles.icon}
                // The glyph itself is the label. A screen reader reads the emoji's own name,
                // which is the only name for it anybody agrees on.
                aria-label={icon}
                aria-pressed={icon === value.icon}
                onClick={() => onChange({ icon, color: value.color })}
              >
                <span aria-hidden="true">{icon}</span>
              </button>
            ))}
          </div>
        </div>
      ))}

      {/* A form so that Enter commits, for the same reason the date box is one: the keymap
          lint refuses a local key handler, and submitting is the platform's own answer. */}
      <form
        className={styles.custom}
        onSubmit={(event) => {
          event.preventDefault();
          const typed = fieldRef.current?.value.trim() ?? '';
          if (typed === '') return;
          // One glyph, not a word. Somebody pasting a sentence has pasted the wrong thing, and
          // a sidebar row is not the place to find that out.
          onChange({ icon: [...typed][0] ?? '', color: value.color });
        }}
      >
        <Input
          ref={fieldRef}
          label="Or any emoji"
          defaultValue={value.icon}
          autoComplete="off"
          maxLength={8}
        />
      </form>

      <ColorPicker
        label={`${label} colour`}
        value={value.color}
        onChange={(color) => onChange({ icon: value.icon, color })}
      />
    </Popover>
  );
}
