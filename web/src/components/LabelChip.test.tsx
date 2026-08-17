import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { LabelChip } from './LabelChip';

describe('LabelChip', () => {
  it('renders the name, which is what is read', () => {
    render(<LabelChip name="bug" color="#e11" />);
    expect(screen.getByText('bug')).toBeTruthy();
  });

  // "P0" alone is a mystery to anybody who has not memorised the taxonomy, and two labels
  // called "High" in different groups are indistinguishable without their group.
  it('qualifies a grouped label with its group', () => {
    render(<LabelChip name="P0" color="#f00" groupName="Priority" />);
    expect(screen.getByText(/Priority:/)).toBeTruthy();
    expect(screen.getByText(/P0/)).toBeTruthy();
  });

  // The colour is workspace data and enters through exactly one custom property, so the
  // dot and the wash cannot drift apart.
  it('takes the colour as a custom property rather than a class', () => {
    const { container } = render(<LabelChip name="bug" color="rgb(1, 2, 3)" />);
    const chip = container.firstElementChild as HTMLElement;
    expect(chip.style.getPropertyValue('--label-color')).toBe('rgb(1, 2, 3)');
  });

  describe('removal', () => {
    it('offers no control when there is nothing to call', () => {
      render(<LabelChip name="bug" color="#e11" />);
      expect(screen.queryByRole('button')).toBeNull();
    });

    // A row of six chips otherwise offers a screen-reader user six identical "Remove"
    // buttons.
    it('names the control by what it removes', () => {
      render(<LabelChip name="P0" color="#f00" groupName="Priority" onRemove={() => {}} />);
      expect(screen.getByRole('button', { name: 'Remove label Priority: P0' })).toBeTruthy();
    });

    // The chip usually sits inside a clickable issue row, and removing a label must not
    // also open the issue.
    it('does not let the click reach the row behind it', async () => {
      const onRemove = vi.fn();
      const onRowClick = vi.fn();
      // A link, because that is what an issue row is — it navigates. It is also the only
      // valid container: a button inside a button is invalid HTML, and a bare div with a
      // click handler would be a fixture the product does not contain.
      render(
        <a href="#issue" onClick={onRowClick}>
          Fix the login redirect
          <LabelChip name="bug" color="#e11" onRemove={onRemove} />
        </a>,
      );

      await userEvent.click(screen.getByRole('button', { name: /Remove label/ }));

      expect(onRemove).toHaveBeenCalledOnce();
      expect(onRowClick).not.toHaveBeenCalled();
    });
  });
});
