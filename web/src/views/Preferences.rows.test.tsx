/**
 * The preferences screen on the settings frame: one h1, a section per group, and every
 * control on a row that names it.
 *
 * The row's label is drawn, not wired, so each control has to keep its own accessible name
 * — that is the contract this file holds the screen to. A control that lost its name when
 * its visible label moved onto the row would still look right and be unfindable.
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getPrefs } from '~/features/prefs/prefs';
import { applyTheme } from '~/styles/theme';

import { Preferences } from './Preferences';

// The same in-memory storage `prefs.test.ts` stands in with: this jsdom has no working
// localStorage, and the screen writes through `globalThis.localStorage` when there is one.
const memory = new Map<string, string>();

beforeEach(() => {
  memory.clear();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => memory.get(key) ?? null,
      setItem: (key: string, value: string) => {
        memory.set(key, value);
      },
      removeItem: (key: string) => {
        memory.delete(key);
      },
    },
  });
});

afterEach(() => {
  memory.clear();
  applyTheme('system');
});

describe('Preferences rows', () => {
  it('sets the page as one h1 with a section per group', () => {
    render(<Preferences />);

    expect(screen.getByRole('heading', { level: 1, name: 'Preferences' })).toBeTruthy();
    expect(screen.getAllByRole('heading', { level: 2 }).map((node) => node.textContent)).toEqual([
      'General',
      'Interface',
      'Automations',
    ]);
  });

  it('keeps every control findable by the name its row draws', () => {
    render(<Preferences />);

    for (const name of ['Default home view', 'First day of the week', 'Comment submit key']) {
      expect(screen.getByRole('combobox', { name })).toBeTruthy();
    }
    expect(screen.getByRole('combobox', { name: 'Theme' })).toBeTruthy();
    expect(screen.getByRole('combobox', { name: 'Font size' })).toBeTruthy();
    for (const name of [
      'Show full names',
      'Convert text emoticons into emoji',
      'Pointer cursor on buttons and links',
      'Underline links',
      'Assign issues I create to myself',
      'Assign to myself when I move an issue to started',
    ]) {
      expect(screen.getByRole('checkbox', { name })).toBeTruthy();
    }
  });

  // The hint that used to hang under the checkbox is the row's description now. It has to
  // survive the move, because it is the sentence that says what "off" means.
  it('draws the hint that belonged to a control as its row description', () => {
    render(<Preferences />);

    expect(
      screen.getByText('Off uses usernames. Mentions and the assignee picker follow this.'),
    ).toBeTruthy();
    expect(
      screen.getByText('Opened on launch. Favourites still live in the sidebar.'),
    ).toBeTruthy();
  });

  it('still writes a preference from its row', async () => {
    const user = userEvent.setup();
    render(<Preferences />);

    const before = getPrefs().fullNames;
    await user.click(screen.getByRole('checkbox', { name: 'Show full names' }));
    expect(getPrefs().fullNames).toBe(!before);

    await user.selectOptions(screen.getByRole('combobox', { name: 'Theme' }), 'dark');
    expect(getPrefs().theme).toBe('dark');
  });
});
