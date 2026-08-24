/**
 * Correcting a comment in place.
 *
 * A comment is a sentence somebody said in a conversation, so fixing a typo has to stay the
 * same sentence rather than becoming a second one underneath: a thread read top to bottom
 * turns a correction posted as a reply into two statements where there was one. The server
 * allows this to the author alone, which is why the pencil that opens this form is drawn for
 * the author alone — a button whose only possible outcome is "you can only edit your own
 * comments" is worse than no button.
 *
 * The edit is stamped `editedAt` on both sides, so the "edited" marker beside the timestamp
 * says something true rather than being a state nothing can reach.
 */

import { useState, type FormEvent, type KeyboardEvent } from 'react';

import { useEngine } from '~/app/context';
import { Button, Textarea } from '~/components';
import type { Comment } from '~/store';
import { ApiError } from '~/sync/api';

import styles from './CommentEditor.module.css';
import { editComment } from './mutations';

interface CommentEditorProps {
  readonly comment: Comment;
  readonly onDone: () => void;
}

export function CommentEditor({ comment, onDone }: CommentEditorProps) {
  const engine = useEngine();
  const [body, setBody] = useState(comment.body);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    const next = body.trim();
    // The server refuses an empty comment, and rightly: deleting one is the way to take it
    // back, and it is one button along.
    if (saving || next === '') return;
    setSaving(true);
    setError(null);
    try {
      await editComment(engine, comment.id, next);
      onDone();
    } catch (failure) {
      setSaving(false);
      setError(failure instanceof ApiError ? failure.message : 'That edit could not be saved.');
    }
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    void save();
  };

  // ⌘⏎ and Escape are handled here and stopped here, rather than registered.
  //
  // Both are global chords: the keymap hears them through a window listener even while a
  // text field has focus. The issue screen binds ⌘⏎ to "Post comment", so a chord that
  // reaches the registry from inside this box sends whatever is sitting in the composer at
  // the foot of the page instead of saving the line being corrected — and Escape, left to
  // travel, closes whatever is around it while an unsaved edit is open. This is the trap
  // case the pragma exists for: it intercepts two keys before the surrounding context sees
  // them, and neither belongs in the command menu as a thing you can choose to do.
  //
  // keymap-lint-allow: a focus trap around an open editor, intercepting ⌘⏎ and Escape
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      event.stopPropagation();
      void save();
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onDone();
    }
  };

  return (
    <form className={styles.form} onSubmit={onSubmit}>
      {error === null ? null : (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      <Textarea
        label="Edit comment"
        hideLabel
        minRows={2}
        maxRows={16}
        autoFocus
        value={body}
        onChange={(event) => setBody(event.target.value)}
        // keymap-lint-allow: see onKeyDown above — a trap, not a shortcut
        onKeyDown={onKeyDown}
      />
      <div className={styles.actions}>
        <Button type="submit" variant="primary" size="sm" disabled={saving || body.trim() === ''}>
          Save changes
        </Button>
        <Button type="button" size="sm" onClick={onDone} disabled={saving}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
