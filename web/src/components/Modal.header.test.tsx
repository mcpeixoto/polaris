import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Modal } from './Modal';

/**
 * A custom header takes the title row's place on the page and nowhere else: the dialog is
 * still named by `title`, so a breadcrumb that reads "ENG › New issue" is announced as
 * "New issue" — and the default close button goes with the row it belonged to, because the
 * header that replaced it is where the caller draws its own.
 */
describe('Modal with a custom header', () => {
  it('keeps its accessible name and hands the row to the caller', () => {
    render(
      <Modal
        open
        onClose={() => {}}
        title="New issue"
        size="composer"
        header={
          <div>
            <span>ENG › New issue</span>
            <button>Close</button>
          </div>
        }
      >
        <input aria-label="Title" />
      </Modal>,
    );

    const dialog = screen.getByRole('dialog', { name: 'New issue' });
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(screen.getByText('ENG › New issue')).toBeTruthy();
    // One close button: the caller's. The default row, and its button, are not rendered.
    expect(screen.getAllByRole('button', { name: 'Close' })).toHaveLength(1);
    expect(screen.queryByRole('heading', { name: 'New issue' })).not.toBeNull();
  });
});
