/**
 * The component library: the whole of what a screen is allowed to build from.
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

// Exported so that the second confirm dialogue never gets written. It was missing from this
// list while every caller deep-imported it, which is exactly how a second one appears.
export { ConfirmDialog } from './ConfirmDialog';
export type { ConfirmDialogProps } from './ConfirmDialog';

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

export { Logo } from './Logo';
export type { LogoProps, LogoSize } from './Logo';

export { Menu } from './Menu';
export type {
  MenuHeading,
  MenuItem,
  MenuNode,
  MenuPlacement,
  MenuProps,
  MenuSeparator,
  MenuSubmenu,
} from './Menu';

export { Modal } from './Modal';
export type { ModalProps, ModalSize } from './Modal';

export { priorityLabel, PriorityIcon, PRIORITY_LABELS, PRIORITY_LEVELS } from './PriorityIcon';
export type { PriorityIconProps } from './PriorityIcon';

export { Progress } from './Progress';
export type { ProgressProps } from './Progress';

export { SecretField } from './SecretField';
export type { SecretFieldProps } from './SecretField';

export { Select } from './Select';
export type { SelectProps } from './Select';

export { Skeleton, SkeletonRows } from './Skeleton';
export type { SkeletonProps, SkeletonRowsProps } from './Skeleton';

export { Spinner } from './Spinner';
export type { SpinnerProps, SpinnerSize } from './Spinner';

export { StateIcon, STATE_LABELS } from './StateIcon';
export type { StateIconProps } from './StateIcon';

export { Textarea } from './Textarea';
export type { TextareaProps } from './Textarea';
// Lives beside Textarea because it is the reason Textarea is not a controlled component;
// exported for the description editor, which builds its own textarea over a mark overlay.
export { useNativeValue } from './nativeValue';

export { Tooltip } from './Tooltip';
export type { TooltipPlacement, TooltipProps } from './Tooltip';

// The settings frame. One page chrome, one section shape, one danger zone and one way of
// saying a write landed — added because ten settings stylesheets had each grown their own.
export { SettingsPage } from './SettingsPage';
export type { SettingsPageProps } from './SettingsPage';

export { SettingsSection } from './SettingsSection';
export type { SettingsSectionProps } from './SettingsSection';

export { DangerZone, DangerZoneRow } from './DangerZone';
export type { DangerZoneProps, DangerZoneRowProps } from './DangerZone';

export { SaveIndicator, useSaveState } from './SaveIndicator';
export type { SaveIndicatorProps, SaveState, SaveStateHandle } from './SaveIndicator';

// A colour that is data rather than paint: swatches for the common answer, a hex field for
// the workspace's own, and one commit per choice instead of one per frame of a drag.
export { ColorPicker, SWATCHES, contrastRatio } from './ColorPicker';
export type { ColorPickerProps } from './ColorPicker';

// One value, one clipboard write, one announcement. Lifted out of SecretField because three
// screens had each hand-rolled a version that went silent when the clipboard was refused and
// renamed its own button "Copied" for good.
export { CopyButton } from './CopyButton';
export type { CopyButtonProps } from './CopyButton';
