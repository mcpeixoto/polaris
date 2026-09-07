/**
 * One of these is in force, and the control has to say which without relying on the tint.
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { SegmentedControl } from './SegmentedControl';

const scopes = [
  { value: 'active', label: 'Active' },
  { value: 'backlog', label: 'Backlog' },
  { value: 'all', label: 'All' },
] as const;

describe('SegmentedControl', () => {
  it('is a named group whose chosen segment is announced as pressed', () => {
    render(
      <SegmentedControl
        options={scopes}
        value="backlog"
        onChange={() => {}}
        aria-label="Which issues"
      />,
    );

    expect(screen.getByRole('group', { name: 'Which issues' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Backlog' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    expect(screen.getByRole('button', { name: 'Active' }).getAttribute('aria-pressed')).toBe(
      'false',
    );
  });

  it('reports the segment that was chosen', async () => {
    const onChange = vi.fn();
    render(
      <SegmentedControl
        options={scopes}
        value="active"
        onChange={onChange}
        aria-label="Which issues"
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'All' }));
    expect(onChange).toHaveBeenCalledWith('all');
  });

  // Otherwise every caller re-sorts a list into the order it is already in.
  it('says nothing when the segment already in force is clicked', async () => {
    const onChange = vi.fn();
    render(
      <SegmentedControl
        options={scopes}
        value="active"
        onChange={onChange}
        aria-label="Which issues"
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Active' }));
    expect(onChange).not.toHaveBeenCalled();
  });

  // A segment drawn as a glyph still has to have a name.
  it('takes a spoken name for a segment whose label cannot stand alone', () => {
    render(
      <SegmentedControl
        options={[
          { value: 'asc', label: '↑', 'aria-label': 'Ascending' },
          { value: 'desc', label: '↓', 'aria-label': 'Descending' },
        ]}
        value="asc"
        onChange={() => {}}
        aria-label="Sort direction"
      />,
    );

    expect(screen.getByRole('button', { name: 'Descending' })).toBeTruthy();
  });
});
