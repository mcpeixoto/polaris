/**
 * Shared context-menu items for entity lists: projects, initiatives, cycles, documents,
 * milestones, and sidebar favourites.
 *
 * The point is one order and one wording — Open → Copy link → Favorite → properties →
 * Archive/Delete — so a person who learns the menu on projects has learned it on documents.
 * Surfaces still own their property pickers and confirm dialogs; this only builds the nodes.
 */

import type { ReactNode } from 'react';

import type { MenuNode } from '~/components';

export interface EntityRowMenuTarget {
  readonly noun: string;
  readonly name?: string | undefined;
  readonly favorited?: boolean | undefined;
}

export interface EntityRowMenuCommands {
  open(): void;
  copyLink?(): void;
  toggleFavorite?(): void;
  /** Property rows already built by the caller (Status…, Lead…, …). */
  properties?: readonly MenuNode[] | undefined;
  archive?(): void;
  /** Prefer confirm dialogs at the call site; this only draws the row. */
  askDelete?(): void;
  /** Override labels when the surface's verb is not Archive/Delete. */
  archiveLabel?: string | undefined;
  deleteLabel?: string | undefined;
  openLabel?: string | undefined;
  openIcon?: ReactNode | undefined;
  favoriteIcon?: ReactNode | undefined;
  copyIcon?: ReactNode | undefined;
  archiveIcon?: ReactNode | undefined;
  deleteIcon?: ReactNode | undefined;
}

export function entityRowMenuItems(
  target: EntityRowMenuTarget,
  commands: EntityRowMenuCommands,
): MenuNode[] {
  const items: MenuNode[] = [
    {
      id: 'open',
      label: commands.openLabel ?? `Open ${target.noun}`,
      ...(commands.openIcon === undefined ? {} : { icon: commands.openIcon }),
      onSelect: () => commands.open(),
    },
  ];

  if (commands.copyLink !== undefined) {
    const copyLink = commands.copyLink;
    items.push({
      id: 'copy-link',
      label: 'Copy link',
      ...(commands.copyIcon === undefined ? {} : { icon: commands.copyIcon }),
      onSelect: () => copyLink(),
    });
  }

  if (commands.toggleFavorite !== undefined) {
    const toggleFavorite = commands.toggleFavorite;
    const favorited = target.favorited === true;
    items.push({
      id: 'favorite',
      label: favorited ? 'Remove from favourites' : 'Add to favourites',
      ...(commands.favoriteIcon === undefined ? {} : { icon: commands.favoriteIcon }),
      onSelect: () => toggleFavorite(),
    });
  }

  const properties = commands.properties ?? [];
  if (properties.length > 0) {
    items.push({ kind: 'separator' }, ...properties);
  }

  const destructive: MenuNode[] = [];
  if (commands.archive !== undefined) {
    const archive = commands.archive;
    destructive.push({
      id: 'archive',
      label: commands.archiveLabel ?? `Archive ${target.noun}`,
      ...(commands.archiveIcon === undefined ? {} : { icon: commands.archiveIcon }),
      danger: true,
      onSelect: () => archive(),
    });
  }
  if (commands.askDelete !== undefined) {
    const askDelete = commands.askDelete;
    destructive.push({
      id: 'delete',
      label:
        commands.deleteLabel ??
        (target.name === undefined ? `Delete ${target.noun}` : `Delete ${target.name}`),
      ...(commands.deleteIcon === undefined ? {} : { icon: commands.deleteIcon }),
      danger: true,
      onSelect: () => askDelete(),
    });
  }
  if (destructive.length > 0) {
    items.push({ kind: 'separator' }, ...destructive);
  }

  return items;
}
