import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ConfirmDialog } from './ConfirmDialog';

/**
 * The consequence is this component's entire reason for existing, and it used to be a plain
 * paragraph in the body: a screen-reader user heard the question, landed on Cancel, and was
 * never told what the other button takes away.
 */
describe('ConfirmDialog', () => {
  it('describes the dialog with the consequence', () => {
    render(
      <ConfirmDialog
        open
        title="Remove Ada Lovelace from Acme?"
        consequence="Ada loses access to this workspace and its 3 teams. Their issues and comments stay exactly as they are."
        confirmLabel="Remove Ada"
        destructive
        onConfirm={() => {}}
        onClose={() => {}}
      />,
    );

    const dialog = screen.getByRole('dialog', { name: 'Remove Ada Lovelace from Acme?' });
    const describedBy = dialog.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();

    const description = document.getElementById(describedBy ?? '');
    expect(description?.textContent).toBe(
      'Ada loses access to this workspace and its 3 teams. Their issues and comments stay exactly as they are.',
    );
    // Once, not twice: the local paragraph that used to draw it as well is gone.
    expect(screen.getAllByText(/Ada loses access/)).toHaveLength(1);
  });

  it('still shows a refusal as an alert beside the actions', () => {
    render(
      <ConfirmDialog
        open
        title="Revoke this key?"
        consequence="Anything using it stops working immediately."
        confirmLabel="Revoke key"
        error="That key belongs to another workspace"
        onConfirm={() => {}}
        onClose={() => {}}
      />,
    );

    expect(screen.getByRole('alert').textContent).toBe('That key belongs to another workspace');
  });
});
