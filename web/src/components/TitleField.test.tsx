/**
 * The field a detail screen renames itself from.
 *
 * Three properties, and each of them is a bug that has already happened: the draft exists
 * only while the field has focus, so a rename arriving over sync does not overwrite what
 * somebody is typing; leaving the field commits; and leaving the *screen* without a blur —
 * the back button, a closed tab — still writes what was typed.
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { TitleField } from './TitleField';

describe('TitleField', () => {
  it('shows the stored value until it is typed into, and saves on blur', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(<TitleField subjectId="p1" value="Launch" label="Project name" onSave={onSave} />);

    const field = screen.getByLabelText('Project name');
    await user.click(field);
    await user.type(field, ' day one');
    expect(onSave).not.toHaveBeenCalled();

    await user.tab();
    expect(onSave).toHaveBeenCalledWith('Launch day one');
  });

  it('keeps the draft when the stored value changes underneath', async () => {
    const user = userEvent.setup();
    const view = render(
      <TitleField subjectId="p1" value="Launch" label="Project name" onSave={vi.fn()} />,
    );

    const field = screen.getByLabelText('Project name') as HTMLTextAreaElement;
    await user.click(field);
    await user.type(field, ' day one');

    view.rerender(
      <TitleField subjectId="p1" value="Renamed elsewhere" label="Project name" onSave={vi.fn()} />,
    );

    expect(field.value).toBe('Launch day one');
  });

  it('saves nothing for a title emptied by mistake', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(<TitleField subjectId="p1" value="Launch" label="Project name" onSave={onSave} />);

    await user.clear(screen.getByLabelText('Project name'));
    await user.tab();

    expect(onSave).not.toHaveBeenCalled();
  });

  it('flushes the edit when the field leaves without a blur', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    const view = render(
      <TitleField subjectId="p1" value="Launch" label="Project name" onSave={onSave} />,
    );

    await user.click(screen.getByLabelText('Project name'));
    await user.type(screen.getByLabelText('Project name'), ' day one');
    view.unmount();

    expect(onSave).toHaveBeenCalledWith('Launch day one');
  });
});
