import { useState } from 'react';

import styles from './Avatar.module.css';

export type AvatarSize = 'xs' | 'sm' | 'md';

export interface AvatarProps {
  /** The person's display name. Supplies the initials and, by default, the colour. */
  name: string;
  src?: string | null | undefined;
  size?: AvatarSize | undefined;
  /**
   * What the colour is derived from, when that should not be the name. Pass the user id in
   * lists that outlive a rename: keyed on the name, changing "Ada" to "Ada L." repaints that
   * person for everyone, and colour is how a reader finds a familiar row without reading it.
   */
  colorKey?: string | undefined;
  /**
   * Set where the person's name is already written next to the avatar. The image then adds
   * nothing to the accessibility tree, and announcing "Ada Lovelace, Ada Lovelace" is worse
   * than announcing it once.
   */
  decorative?: boolean | undefined;
  className?: string | undefined;
}

/** The number of hues in Avatar.module.css. Kept beside the hash that indexes them. */
const HUE_COUNT = 8;

/**
 * The rendered size of each variant, in pixels, matching the `--space-*` tokens the
 * stylesheet uses.
 *
 * Duplicating a number the CSS also states is worth it here, because `width`/`height`
 * attributes are a different mechanism from a `width` declaration: they give the browser an
 * intrinsic size before the image has loaded, so a virtualised list of five hundred rows does
 * not reflow as each photo arrives. The stylesheet still wins on the drawn size — these are
 * the aspect ratio and the reservation, not the layout.
 */
const SIZE_PX: Readonly<Record<AvatarSize, number>> = { xs: 16, sm: 20, md: 24 };

function firstCharacterOf(word: string): string {
  // Code points, not UTF-16 units: `charAt(0)` on an emoji or an astral-plane letter returns
  // half a surrogate pair, which renders as a replacement glyph.
  return [...word][0] ?? '';
}

/**
 * initialsOf reduces a display name to the one or two letters an avatar can hold.
 *
 * First and last word, because that is where a name's distinguishing letters are — "Ada
 * Byron Lovelace" is AL to everyone who knows her, and the middle initial is the one a
 * reader scanning a list does not use. A name with no letters at all still has to render
 * something, and a placeholder is more honest than an empty circle that looks like a
 * missing avatar.
 */
export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const first = words[0];
  if (first === undefined) return '?';
  const last = words.length > 1 ? words[words.length - 1] : undefined;
  return (
    firstCharacterOf(first) + (last === undefined ? '' : firstCharacterOf(last))
  ).toUpperCase();
}

/**
 * avatarHue picks one of the palette's hues, and the same one every time.
 *
 * Determinism is the whole requirement, and it has to hold across machines and across
 * reloads: two people looking at the same issue list must see the same person in the same
 * colour, or the colour stops being a recognition cue and becomes noise. So the hue comes
 * from a hash of a stable key rather than from a counter, a palette cursor, or anything
 * that depends on the order rows happened to arrive in.
 *
 * FNV-1a because it is four lines, has no dependency, and spreads short ASCII strings —
 * which is what names are — evenly across eight buckets. It is not a cryptographic choice
 * and nothing here should treat it as one.
 */
export function avatarHue(key: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0) % HUE_COUNT;
}

/**
 * Avatar identifies a person in a row, a comment, an assignee picker.
 *
 * The initials are not a placeholder for a missing photo, they are the normal case: most
 * workspaces upload few avatars, and a grid of identical grey silhouettes tells a reader
 * nothing. Initials plus a stable colour tell them who, at 16 pixels, without reading.
 */
export function Avatar({
  name,
  src,
  size = 'md',
  colorKey,
  decorative = false,
  className,
}: AvatarProps) {
  // Keyed by url rather than a boolean, so a person who uploads a new photo after a broken
  // one is not stuck on their initials for the life of the session.
  const [brokenSrc, setBrokenSrc] = useState<string | null>(null);
  const usable = src !== null && src !== undefined && src !== '' && src !== brokenSrc;

  const initials = initialsOf(name);
  const hue = avatarHue(colorKey ?? name);

  // At 16 pixels two glyphs collide into an unreadable smudge, so the smallest size drops
  // to a single initial. It stays a recognition cue rather than becoming decoration.
  const shown = size === 'xs' ? initials.slice(0, 1) : initials;

  return (
    <span
      className={[styles.avatar, styles[size], usable ? null : styles[`hue${hue}`], className]
        .filter(Boolean)
        .join(' ')}
      role={decorative ? undefined : 'img'}
      aria-label={decorative ? undefined : name}
      aria-hidden={decorative ? true : undefined}
    >
      {usable ? (
        // Empty alt: the wrapper already carries the name, and an alt here would have a
        // screen reader read it twice.
        <img
          className={styles.image}
          src={src}
          alt=""
          width={SIZE_PX[size]}
          height={SIZE_PX[size]}
          // A virtualised issue list mounts hundreds of these at once, most of them off
          // screen. Lazy defers the request until the row is worth painting, and async
          // decoding keeps the one that does arrive off the thread the list is scrolling on.
          loading="lazy"
          decoding="async"
          onError={() => setBrokenSrc(src)}
        />
      ) : (
        <span className={styles.initials} aria-hidden="true">
          {shown}
        </span>
      )}
    </span>
  );
}
