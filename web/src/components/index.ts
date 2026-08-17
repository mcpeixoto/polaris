/**
 * The component library: seventeen primitives, and the whole of what a screen is allowed to
 * build from.
 *
 * Everything here obeys the same three rules, and they are what make the set a system
 * rather than a folder. Nothing owns a colour or a measurement — every value is a token
 * from styles/tokens.css, so a custom theme is a list of declarations and not a fork.
 * Nothing owns a shortcut — the keyboard belongs to web/src/keys, and the only exceptions
 * are Menu and Modal, which trap keys they have taken over the screen with. And nothing
 * ships without its accessible name, its roles and a visible focus ring, because in a
 * product whose primary interface is the keyboard, an unreachable control is a broken one.
 *
 * A screen that needs something not in this list should add it here rather than build it
 * locally: the second copy of a menu is the one that will be missing type-ahead.
 */

export { Avatar, avatarHue, initialsOf } from './Avatar';
export type { AvatarProps, AvatarSize } from './Avatar';

export { Badge } from './Badge';
export type { BadgeProps, BadgeTone } from './Badge';

export { Button } from './Button';
export type { ButtonProps, ButtonSize, ButtonVariant } from './Button';

export { Checkbox } from './Checkbox';
export type { CheckboxProps } from './Checkbox';

export { EmptyState } from './EmptyState';
export type { EmptyStateProps } from './EmptyState';

export { Field, fieldDescribedBy, fieldInvalid, useFieldIds } from './Field';
export type { FieldIds, FieldMessages, FieldProps } from './Field';

export { IconButton } from './IconButton';
export type { IconButtonProps, IconButtonSize, IconButtonVariant } from './IconButton';

export { Input } from './Input';
export type { InputProps } from './Input';

export { Kbd } from './Kbd';
export type { KbdProps } from './Kbd';

export { LabelChip } from './LabelChip';
export type { LabelChipProps } from './LabelChip';

export { Menu } from './Menu';
export type {
  MenuHeading,
  MenuItem,
  MenuNode,
  MenuPlacement,
  MenuProps,
  MenuSeparator,
} from './Menu';

export { Modal } from './Modal';
export type { ModalProps, ModalSize } from './Modal';

export { priorityLabel, PriorityIcon, PRIORITY_LABELS, PRIORITY_LEVELS } from './PriorityIcon';
export type { PriorityIconProps } from './PriorityIcon';

export { Progress } from './Progress';
export type { ProgressProps } from './Progress';

export { Select } from './Select';
export type { SelectProps } from './Select';

export { Spinner } from './Spinner';
export type { SpinnerProps, SpinnerSize } from './Spinner';

export { StateIcon, STATE_LABELS } from './StateIcon';
export type { StateIconProps } from './StateIcon';

export { Textarea } from './Textarea';
export type { TextareaProps } from './Textarea';

export { Tooltip } from './Tooltip';
export type { TooltipPlacement, TooltipProps } from './Tooltip';
