/**
 * Markdown writing with slash blocks, input rules, and @mentions.
 *
 * The detail description editor carries inline comment threads on top of the same rules; the
 * create dialog and the issue comment composers need the writing half without that overlay.
 * This is that half — one textarea, not a second TipTap.
 */

import {
  useRef,
  useState,
  type ClipboardEvent as ReactClipboardEvent,
  type DragEvent as ReactDragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type Ref,
  type TextareaHTMLAttributes,
} from 'react';

import { Textarea } from '~/components';
import { pasteImagesInto } from '~/features/files/pasteImages';
import { imageFilesFromDataTransfer } from '~/features/files/upload';
import { report } from '~/features/issue/mutations';
import type { UUID } from '~/store';

import { insertBlock, type BlockKind } from './blocks';
import { applyEnterRule, applySpaceRule, type EditorState } from './inputRules';
import { insertMention } from './mentions';
import { MentionMenu } from './MentionMenu';
import { SlashMenu } from './SlashMenu';
import styles from './WritingField.module.css';

export interface WritingFieldProps extends Omit<
  TextareaHTMLAttributes<HTMLTextAreaElement>,
  'children' | 'defaultValue' | 'rows' | 'style' | 'value' | 'onChange'
> {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly label: string;
  readonly hideLabel?: boolean | undefined;
  readonly surface?: 'boxed' | 'plain' | 'bare' | undefined;
  readonly minRows?: number | undefined;
  readonly maxRows?: number | undefined;
  readonly error?: string | undefined;
  readonly className?: string | undefined;
  readonly ref?: Ref<HTMLTextAreaElement> | undefined;
  /** Slash menu + list/fence input rules. Off for a one-line comment that should stay light. */
  readonly blocks?: boolean | undefined;
  /** `@` mention picker. On by default wherever this field is used. */
  readonly mentions?: boolean | undefined;
  /**
   * When set, a pasted / dropped image is also attached to this issue as a link card.
   * Create dialogs leave it unset — there is no issue yet.
   */
  readonly issueId?: UUID | undefined;
}

export function WritingField({
  value,
  onChange,
  label,
  hideLabel,
  surface = 'boxed',
  minRows,
  maxRows,
  error,
  className,
  ref,
  blocks = true,
  mentions = true,
  issueId,
  onKeyDown,
  onBlur,
  onPaste,
  onDrop,
  onDragOver,
  ...rest
}: WritingFieldProps) {
  const areaRef = useRef<HTMLTextAreaElement | null>(null);
  const slashAnchorRef = useRef<HTMLSpanElement | null>(null);
  const mentionAnchorRef = useRef<HTMLSpanElement | null>(null);
  const [slashAt, setSlashAt] = useState<number | null>(null);
  const [mentionAt, setMentionAt] = useState<number | null>(null);
  const [uploading, setUploading] = useState(false);

  const setRefs = (node: HTMLTextAreaElement | null) => {
    areaRef.current = node;
    if (typeof ref === 'function') ref(node);
    else if (ref !== null && ref !== undefined) {
      (ref as { current: HTMLTextAreaElement | null }).current = node;
    }
  };

  const stateOf = (): EditorState | null => {
    const element = areaRef.current;
    if (element === null || element.selectionStart !== element.selectionEnd) return null;
    return { text: element.value, caret: element.selectionStart };
  };

  const applyEdit = (next: EditorState) => {
    const element = areaRef.current;
    if (element === null) return;
    element.value = next.text;
    element.setSelectionRange(next.caret, next.caret);
    onChange(next.text);
  };

  const closeSlash = () => {
    setSlashAt(null);
    areaRef.current?.focus();
  };

  const closeMention = () => {
    setMentionAt(null);
    areaRef.current?.focus();
  };

  const chooseBlock = (kind: BlockKind) => {
    const from = slashAt;
    const state = stateOf();
    setSlashAt(null);
    if (from === null || state === null) return;
    applyEdit(insertBlock(state, from, kind));
    areaRef.current?.focus();
  };

  const chooseMention = (user: { readonly id: string; readonly name: string }) => {
    const from = mentionAt;
    const state = stateOf();
    setMentionAt(null);
    if (from === null || state === null) return;
    applyEdit(insertMention(state, from, user.name, user.id));
    areaRef.current?.focus();
  };

  const handleImages = async (data: DataTransfer | null) => {
    const state = stateOf();
    if (state === null) return false;
    if (imageFilesFromDataTransfer(data).length === 0) return false;
    setUploading(true);
    try {
      const next = await pasteImagesInto(state, data, { issueId });
      if (next === null) return false;
      applyEdit(next);
      return true;
    } catch (error) {
      report(error);
      return true;
    } finally {
      setUploading(false);
      areaRef.current?.focus();
    }
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    onKeyDown?.(event);
    if (event.defaultPrevented) return;
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const state = stateOf();
    if (state === null) return;

    if (blocks && event.key === '/') {
      const before = state.text.slice(state.caret - 1, state.caret);
      if (state.caret !== 0 && before !== '' && !/\s/.test(before)) return;
      event.preventDefault();
      setMentionAt(null);
      applyEdit({
        text: `${state.text.slice(0, state.caret)}/${state.text.slice(state.caret)}`,
        caret: state.caret + 1,
      });
      setSlashAt(state.caret);
      return;
    }

    if (mentions && event.key === '@') {
      const before = state.text.slice(state.caret - 1, state.caret);
      if (state.caret !== 0 && before !== '' && !/\s/.test(before)) return;
      event.preventDefault();
      setSlashAt(null);
      applyEdit({
        text: `${state.text.slice(0, state.caret)}@${state.text.slice(state.caret)}`,
        caret: state.caret + 1,
      });
      setMentionAt(state.caret);
      return;
    }

    if (blocks && event.key === 'Enter' && !event.shiftKey) {
      const next = applyEnterRule(state);
      if (next === null) return;
      event.preventDefault();
      applyEdit(next);
      return;
    }

    if (blocks && event.key === ' ') {
      const next = applySpaceRule(state);
      if (next === null) return;
      event.preventDefault();
      applyEdit(next);
    }
  };

  return (
    <div className={styles.wrap} data-uploading={uploading ? 'true' : undefined}>
      <Textarea
        {...rest}
        ref={setRefs}
        label={label}
        hideLabel={hideLabel}
        surface={surface}
        minRows={minRows}
        maxRows={maxRows}
        error={error}
        className={className}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={handleKeyDown}
        onPaste={(event: ReactClipboardEvent<HTMLTextAreaElement>) => {
          onPaste?.(event);
          if (event.defaultPrevented) return;
          if (imageFilesFromDataTransfer(event.clipboardData).length === 0) return;
          event.preventDefault();
          void handleImages(event.clipboardData);
        }}
        onDragOver={(event: ReactDragEvent<HTMLTextAreaElement>) => {
          onDragOver?.(event);
          if (event.defaultPrevented) return;
          if (imageFilesFromDataTransfer(event.dataTransfer).length === 0) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = 'copy';
        }}
        onDrop={(event: ReactDragEvent<HTMLTextAreaElement>) => {
          onDrop?.(event);
          if (event.defaultPrevented) return;
          if (imageFilesFromDataTransfer(event.dataTransfer).length === 0) return;
          event.preventDefault();
          void handleImages(event.dataTransfer);
        }}
        onBlur={(event) => {
          // Menus take focus while open; that is not the writer leaving the field.
          if (slashAt !== null || mentionAt !== null) return;
          onBlur?.(event);
        }}
      />
      {/* Caret anchors for the menus. Invisible; positioned at the start of the field so the
          menu opens near the writing surface rather than the viewport origin. */}
      <span ref={slashAnchorRef} className={styles.anchor} aria-hidden="true" />
      <span ref={mentionAnchorRef} className={styles.anchor} aria-hidden="true" />
      {blocks ? (
        <SlashMenu
          open={slashAt !== null}
          onClose={closeSlash}
          trigger={slashAnchorRef}
          onInsert={chooseBlock}
        />
      ) : null}
      {mentions ? (
        <MentionMenu
          open={mentionAt !== null}
          onClose={closeMention}
          trigger={mentionAnchorRef}
          onSelect={chooseMention}
        />
      ) : null}
    </div>
  );
}
