/**
 * Select grew a `prefix` slot, and the whole risk of that change is what it might have cost.
 *
 * The reason the product uses a native `<select>` at all is written in the component: the
 * platform's popup, its type-ahead and its keyboard handling are behaviour nobody wants to
 * reimplement, and every one of them is a thing a decorative overlay could plausibly break.
 * So these tests are mostly not about the icon. They are about the control still being a
 * `<select>` with the icon on it — the value changing, the label still naming it, the
 * options still reachable — because a picker that looks right and no longer answers the
 * keyboard is a worse outcome than the missing glyph this slot was added to fix.
 *
 * The one thing asserted about the glyph itself is that it is hidden from the accessibility
 * tree. It repeats the selected option, which is already the control's announced value, and
 * an unhidden duplicate would have a screen reader read the status twice.
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { Select } from './Select';

function TeamSelect(props: { prefix?: React.ReactNode; onChange?: () => void }) {
  return (
    <Select label="Team" prefix={props.prefix} onChange={props.onChange} defaultValue="design">
      <option value="engineering">Engineering</option>
      <option value="design">Design</option>
    </Select>
  );
}

describe('Select', () => {
  it('renders no extra node when there is no prefix', () => {
    const { container } = render(<TeamSelect />);
    // The chevron is the only aria-hidden span a bare select carries.
    expect(container.querySelectorAll('[aria-hidden="true"]')).toHaveLength(1);
  });

  it('renders the prefix and hides it from the accessibility tree', () => {
    render(<TeamSelect prefix={<svg data-testid="glyph" />} />);

    const glyph = screen.getByTestId('glyph');
    expect(glyph.isConnected).toBe(true);
    expect(glyph.closest('[aria-hidden="true"]')).not.toBeNull();
  });

  it('puts the prefix inside the box, beside the select rather than around it', () => {
    render(<TeamSelect prefix={<svg data-testid="glyph" />} />);

    const select = screen.getByLabelText('Team');
    const glyph = screen.getByTestId('glyph');

    // Same parent: the overlay is painted over the control, so both are children of the box.
    // If the glyph ever wrapped the select, the whole box would stop being one click target.
    expect(glyph.closest('span')?.parentElement).toBe(select.parentElement);
    expect(select.contains(glyph)).toBe(false);
  });

  it('keeps the label wired to the select when a prefix is present', () => {
    render(<TeamSelect prefix={<svg data-testid="glyph" />} />);
    expect(screen.getByLabelText('Team').tagName).toBe('SELECT');
  });

  it('still reports a change chosen from the keyboard', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<TeamSelect prefix={<svg />} onChange={onChange} />);

    const select = screen.getByLabelText('Team') as HTMLSelectElement;
    expect(select.value).toBe('design');

    await user.selectOptions(select, 'engineering');

    expect(select.value).toBe('engineering');
    expect(onChange).toHaveBeenCalled();
  });

  it('still exposes every option with a prefix in place', () => {
    render(<TeamSelect prefix={<svg />} />);
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual([
      'Engineering',
      'Design',
    ]);
  });

  it('does not let the prefix consume the RDFa attribute of the same name', () => {
    // `prefix` is a string attribute on React's HTMLAttributes, which is why SelectProps
    // omits it. If the omit were dropped, a ReactNode here would be forwarded to the DOM.
    render(<TeamSelect prefix={<svg data-testid="glyph" />} />);
    expect(screen.getByLabelText('Team').hasAttribute('prefix')).toBe(false);
  });

  it('carries the error through to the control, prefix or not', () => {
    render(
      <Select label="Team" error="Pick a team." prefix={<svg />}>
        <option value="engineering">Engineering</option>
      </Select>,
    );

    const select = screen.getByLabelText('Team');
    const alert = screen.getByRole('alert');
    expect(select.getAttribute('aria-invalid')).toBe('true');
    expect(alert.textContent).toBe('Pick a team.');
    expect(select.getAttribute('aria-describedby')).toBe(alert.id);
  });
});
