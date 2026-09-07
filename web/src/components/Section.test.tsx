/**
 * The section header the issue screen's panels share: the title is the heading, the count
 * is beside it and not part of its name, and the row folds the body without unmounting it.
 */

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';

import { Section } from './Section';

afterEach(cleanup);

describe('Section', () => {
  it('names the region by its title alone, with the count beside it', () => {
    render(
      <Section title="Sub-issues" count={3} action={<button type="button">Add</button>}>
        <p>Three rows</p>
      </Section>,
    );

    expect(screen.getByRole('region', { name: 'Sub-issues' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Sub-issues' })).toBeTruthy();
    expect(screen.getByText('3')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Add' })).toBeTruthy();
  });

  it('folds the body from the heading and unfolds it again', async () => {
    const user = userEvent.setup();
    render(
      <Section title="Links">
        <p>A card</p>
      </Section>,
    );

    const toggle = screen.getByRole('button', { name: 'Links' });
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText('A card')).toBeTruthy();

    await user.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    // Hidden, not gone: the rows keep their state through a fold.
    expect(screen.getByText('A card', { ignore: false }).closest('[hidden]')).not.toBeNull();

    await user.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText('A card').closest('[hidden]')).toBeNull();
  });

  it('takes an explicit name for a region that is not called by its heading', () => {
    render(
      <Section title="Customers" aria-label="Customer requests">
        <p>None</p>
      </Section>,
    );

    expect(screen.getByRole('region', { name: 'Customer requests' })).toBeTruthy();
  });
});
