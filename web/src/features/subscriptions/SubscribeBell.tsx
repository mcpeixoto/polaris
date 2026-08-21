/**
 * The subscribe bell on a project, initiative or customer page.
 *
 * A saved view already has this control in its issue-list header. These pages did not, so
 * the flags the API stores had nowhere to be set.
 */

import { Button, Menu } from '~/components';
import { useMenuTrigger } from '~/hooks/useMenuTrigger';

export interface SubscribeFlag {
  readonly id: string;
  readonly label: string;
  readonly on: boolean;
}

export function SubscribeBell({
  menuLabel,
  flags,
  onToggle,
}: {
  readonly menuLabel: string;
  readonly flags: readonly SubscribeFlag[];
  readonly onToggle: (id: string) => void;
}) {
  const subscribe = useMenuTrigger();
  const watching = flags.some((flag) => flag.on);

  return (
    <>
      <Button {...subscribe.props} variant="ghost" aria-pressed={watching}>
        {watching ? 'Subscribed' : 'Subscribe'}
      </Button>
      <Menu
        open={subscribe.open}
        onClose={subscribe.hide}
        trigger={subscribe.ref}
        label={menuLabel}
        items={[
          { kind: 'heading', label: 'Notify me when' },
          ...flags.map((flag) => ({
            id: flag.id,
            label: flag.label,
            selected: flag.on,
            onSelect: () => {
              onToggle(flag.id);
            },
          })),
        ]}
      />
    </>
  );
}
