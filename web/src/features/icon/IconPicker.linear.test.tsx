import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { KeymapProvider } from '~/app/keymap';
import { useMenuTrigger } from '~/hooks/useMenuTrigger';

import { IconPicker, type IconValue } from './IconPicker';

/**
 * The layout the panel grew: two kinds of glyph, a colour that belongs to neither, and a
 * search box that finds an icon by what it is rather than by what it is called.
 *
 * `IconPicker.test.tsx` pins the commit contract — one change per act — and nothing here
 * repeats it. This file is about the parts that did not exist before: the tabs, the named
 * line icons and their `icon:` tokens, and the rule that the panel opens on whichever tab
 * holds the value it was given.
 */

function Harness({
  onChange = vi.fn(),
  initial,
}: {
  onChange?: (value: IconValue) => void;
  initial: IconValue;
}) {
  const trigger = useMenuTrigger('dialog');
  const [value, setValue] = useState<IconValue>(initial);
  return (
    <KeymapProvider>
      <button {...trigger.props}>Open</button>
      <IconPicker
        open={trigger.open}
        onClose={trigger.hide}
        trigger={trigger.ref}
        value={value}
        onChange={(next) => {
          onChange(next);
          setValue(next);
        }}
        actionId="test.closeIconPicker"
        label="Project icon"
      />
    </KeymapProvider>
  );
}

async function open(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Open' }));
}

describe('IconPicker layout', () => {
  it('opens on the tab that holds the value it was given', async () => {
    const user = userEvent.setup();
    const { unmount } = render(<Harness initial={{ icon: 'icon:rocket', color: '#3b82f6' }} />);
    await open(user);
    expect(screen.getByRole('tab', { name: 'Icons' }).getAttribute('aria-selected')).toBe('true');
    // The grid on that tab is the line icons, named rather than drawn as characters.
    expect(screen.getByRole('button', { name: 'Rocket' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    // Closed before the tree goes, or the portal is torn down mid-transition and React
    // reports a state update outside act() that has nothing to do with what is asserted.
    await user.keyboard('{Escape}');
    unmount();

    render(<Harness initial={{ icon: '🚀', color: '#3b82f6' }} />);
    await open(user);
    expect(screen.getByRole('tab', { name: 'Emojis' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('button', { name: '🚀' }).getAttribute('aria-pressed')).toBe('true');
  });

  // Emojis and not Icons, on purpose — see kindOf. Every icon that exists in a workspace
  // today is an emoji, and the empty case is where that muscle memory lives.
  it('opens on Emojis when nothing is chosen at all', async () => {
    const user = userEvent.setup();
    render(<Harness initial={{ icon: '', color: '#3b82f6' }} />);
    await open(user);

    expect(screen.getByRole('tab', { name: 'Emojis' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('button', { name: '🚀' })).toBeTruthy();
  });

  it('switches grids when the other tab is chosen', async () => {
    const user = userEvent.setup();
    render(<Harness initial={{ icon: '🚀', color: '#3b82f6' }} />);
    await open(user);

    expect(screen.queryByRole('button', { name: 'Rocket' })).toBeNull();
    await user.click(screen.getByRole('tab', { name: 'Icons' }));

    expect(screen.getByRole('button', { name: 'Rocket' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: '🚀' })).toBeNull();
  });

  it('narrows the icon grid by keyword, not only by name', async () => {
    const user = userEvent.setup();
    render(<Harness initial={{ icon: 'icon:rocket', color: '#3b82f6' }} />);
    await open(user);

    // "money" is nobody's icon name. It is a keyword on the ones that mean it.
    await user.type(screen.getByPlaceholderText('Search icons…'), 'money');

    expect(screen.getByRole('button', { name: 'Dollar' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Wallet' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Rocket' })).toBeNull();
  });

  it('says so when a search matches nothing, rather than showing an empty grid', async () => {
    const user = userEvent.setup();
    render(<Harness initial={{ icon: 'icon:rocket', color: '#3b82f6' }} />);
    await open(user);

    await user.type(screen.getByPlaceholderText('Search icons…'), 'zzzz');

    expect(screen.getByRole('status').textContent).toContain('No icon matches');
  });

  it('commits a line icon as its token, keeping the colour it was given', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<Harness onChange={onChange} initial={{ icon: '', color: '#3b82f6' }} />);
    await open(user);
    await user.click(screen.getByRole('tab', { name: 'Icons' }));

    await user.click(screen.getByRole('button', { name: 'Rocket' }));

    expect(onChange.mock.calls).toEqual([[{ icon: 'icon:rocket', color: '#3b82f6' }]]);
  });

  it('marks the chosen line icon, and finds a hyphenated one by its words', async () => {
    const user = userEvent.setup();
    render(<Harness initial={{ icon: 'icon:git-branch', color: '#3b82f6' }} />);
    await open(user);

    const chosen = screen.getByRole('button', { name: 'Git branch' });
    expect(chosen.getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'Rocket' }).getAttribute('aria-pressed')).toBe(
      'false',
    );
  });

  it('commits a colour from the dot row without touching the icon', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<Harness onChange={onChange} initial={{ icon: 'icon:rocket', color: '#3b82f6' }} />);
    await open(user);

    await user.click(screen.getByRole('button', { name: 'Green' }));

    expect(onChange.mock.calls).toEqual([[{ icon: 'icon:rocket', color: '#16a34a' }]]);
  });

  it('marks the dot that is the current colour', async () => {
    const user = userEvent.setup();
    render(<Harness initial={{ icon: 'icon:rocket', color: '#16a34a' }} />);
    await open(user);

    expect(screen.getByRole('button', { name: 'Green' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'Blue' }).getAttribute('aria-pressed')).toBe('false');
  });

  // The colour row is on both tabs on purpose — see the component's header. The colour is a
  // column on the entity, not a property of the glyph, and it survives a switch between them.
  it('offers the colour on the emoji tab too', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<Harness onChange={onChange} initial={{ icon: '🚀', color: '#3b82f6' }} />);
    await open(user);

    await user.click(screen.getByRole('button', { name: 'Green' }));

    expect(onChange.mock.calls).toEqual([[{ icon: '🚀', color: '#16a34a' }]]);
  });

  it('forgets a search when it is reopened', async () => {
    const user = userEvent.setup();
    render(<Harness initial={{ icon: 'icon:rocket', color: '#3b82f6' }} />);
    await open(user);

    await user.type(screen.getByPlaceholderText('Search icons…'), 'money');
    expect(screen.queryByRole('button', { name: 'Rocket' })).toBeNull();

    await user.keyboard('{Escape}');
    await open(user);

    expect(screen.getByRole('button', { name: 'Rocket' })).toBeTruthy();
  });
});
