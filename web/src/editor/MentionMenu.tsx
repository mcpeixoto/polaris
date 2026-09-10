/**
 * The `@` mention menu.
 *
 * Same bargain as SlashMenu: `Menu` owns arrows, type-ahead, Escape and focus restore; this
 * file only names the people and inserts the token the server already understands.
 */

import { useRef, type RefObject } from 'react';

import { Avatar, Menu, type MenuNode } from '~/components';
import { useLiveQuery } from '~/hooks/useLiveQuery';
import type { UUID } from '~/store';

interface MentionMenuProps {
  readonly open: boolean;
  readonly onClose: () => void;
  /** Positioned against a caret marker, not against the whole field. */
  readonly trigger: RefObject<HTMLElement | null>;
  readonly onSelect: (user: { readonly id: UUID; readonly name: string }) => void;
}

export function MentionMenu({ open, onClose, trigger, onSelect }: MentionMenuProps) {
  // Swallow the close Menu fires after a choice so focus can return to the field first —
  // same pattern as multi UserPicker, except choosing *is* the decision here.
  const chose = useRef(false);

  const users = useLiveQuery(
    (store) =>
      [...store.users.values()]
        .filter((user) => user.archivedAt === undefined && user.status === 'active')
        .map((user) => ({
          id: user.id,
          name: user.displayName,
          avatarUrl: user.avatarUrl ?? null,
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    ['user'],
    [],
  );

  const items: MenuNode[] = users.map((user) => ({
    id: user.id,
    label: user.name,
    icon: <Avatar name={user.name} src={user.avatarUrl} size="xs" colorKey={user.id} decorative />,
    onSelect: () => {
      chose.current = true;
      onSelect({ id: user.id, name: user.name });
    },
  }));

  return (
    <Menu
      open={open}
      onClose={() => {
        if (chose.current) {
          chose.current = false;
          onClose();
          return;
        }
        onClose();
      }}
      trigger={trigger}
      items={items}
      label="Mention someone"
      filterable
      filterPlaceholder="Mention…"
      emptyLabel="Nobody by that name"
    />
  );
}
