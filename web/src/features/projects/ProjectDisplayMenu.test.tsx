/**
 * The projects display menu, which is the issue display menu's rows over projects' options.
 *
 * What is asserted here is the contract the list depends on: every control writes a patch
 * immediately — there is no Apply button and there must not be one — and a value that is not
 * the default says which default it replaced.
 */

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { KeymapProvider } from '~/app/keymap';

import { DEFAULT_PROJECT_DISPLAY, type ProjectDisplayOptions } from './display';
import { ProjectDisplayMenu } from './ProjectDisplayMenu';

function mount(display: Partial<ProjectDisplayOptions> = {}) {
  const onChange = vi.fn();
  const trigger = createRef<HTMLButtonElement>();
  render(
    <KeymapProvider>
      <button type="button" ref={trigger}>
        Display
      </button>
      <ProjectDisplayMenu
        display={{ ...DEFAULT_PROJECT_DISPLAY, ...display }}
        onChange={onChange}
        open
        onClose={vi.fn()}
        trigger={trigger}
      />
    </KeymapProvider>,
  );
  return { onChange, user: userEvent.setup() };
}

afterEach(cleanup);

describe('ProjectDisplayMenu', () => {
  it('writes the grouping straight through', async () => {
    const { onChange, user } = mount();

    await user.selectOptions(screen.getByLabelText('Grouping'), 'lead');

    expect(onChange).toHaveBeenCalledWith({ grouping: 'lead' });
  });

  it('writes a column set in the canonical order, whichever box is ticked', async () => {
    const { onChange, user } = mount({ columns: ['lead'] });

    await user.click(screen.getByRole('checkbox', { name: 'Health' }));

    expect(onChange).toHaveBeenCalledWith({ columns: ['health', 'lead'] });
  });

  it('offers the board beside the list and the timeline', async () => {
    const { onChange, user } = mount();

    await user.click(screen.getByRole('button', { name: 'Board' }));

    expect(onChange).toHaveBeenCalledWith({ layout: 'board' });
  });

  it('names the default a changed value replaced', () => {
    mount({ ordering: 'name' });

    expect(screen.getByText('Default: Manual')).toBeTruthy();
  });

  // Nothing is refused: somebody may be about to change the grouping next. But the list is
  // not sorted the way the control claims, and that gap is what people blame software for.
  it('says when the ordering has nothing to decide under the grouping', () => {
    mount({ grouping: 'lead' });

    expect(screen.getByRole('note').textContent).toContain('cannot write it');
  });

  // The columns describe the table. On a board they would be a control that changed nothing
  // on the screen in front of somebody, which is worse than one that is not offered.
  it('leaves the columns out of the board and the timeline', () => {
    mount({ layout: 'board' });

    expect(screen.queryByRole('checkbox', { name: 'Health' })).toBeNull();
  });
});
