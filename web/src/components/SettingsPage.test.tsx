import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { DangerZone, DangerZoneRow } from './DangerZone';
import { SettingsPage } from './SettingsPage';
import { SettingsRow, SettingsSection } from './SettingsSection';

describe('SettingsPage', () => {
  // The frame exists so thirty screens share one document outline: one h1 per page, and
  // every block under it an h2. A page that invents its own heading rank breaks navigation
  // by structure for anybody who moves through a screen that way.
  it('gives the page one h1 and each section an h2', () => {
    render(
      <SettingsPage title="Workspace" description="The name on the sidebar.">
        <SettingsSection title="General">
          <p>body</p>
        </SettingsSection>
        <SettingsSection title="Members">
          <p>body</p>
        </SettingsSection>
      </SettingsPage>,
    );

    expect(screen.getByRole('heading', { level: 1, name: 'Workspace' })).toBeTruthy();
    expect(screen.getAllByRole('heading', { level: 2 }).map((node) => node.textContent)).toEqual([
      'General',
      'Members',
    ]);
  });

  // A page-level failure is assertive: it is the answer to something the user just did.
  it('announces a page-level failure as an alert', () => {
    render(
      <SettingsPage title="Workspace" error="That change could not be saved.">
        <p>body</p>
      </SettingsPage>,
    );

    expect(screen.getByRole('alert').textContent).toBe('That change could not be saved.');
  });

  it('renders no alert region when nothing failed', () => {
    render(
      <SettingsPage title="Workspace">
        <p>body</p>
      </SettingsPage>,
    );

    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('SettingsSection', () => {
  // A refusal three sections away from the form that caused it is a refusal nobody
  // connects to their own action, so the section owns its own alert slot.
  it('keeps its own failure beside its own controls', () => {
    render(
      <SettingsSection title="Labels" error="Refused.">
        <p>body</p>
      </SettingsSection>,
    );

    expect(screen.getByRole('alert').textContent).toBe('Refused.');
  });

  it('drops the header entirely when it has no title, actions or status', () => {
    render(
      <SettingsSection description="Just prose.">
        <p>body</p>
      </SettingsSection>,
    );

    expect(screen.queryByRole('heading')).toBeNull();
  });
});

describe('DangerZone', () => {
  it('names itself and spells out what each row takes away', () => {
    render(
      <DangerZone description="These cannot be undone.">
        <DangerZoneRow
          title="Delete this team"
          consequence="Every issue in it goes with it."
          action={<button type="button">Delete team</button>}
        />
      </DangerZone>,
    );

    expect(screen.getByRole('heading', { level: 2, name: 'Danger zone' })).toBeTruthy();
    expect(screen.getByText('Every issue in it goes with it.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Delete team' })).toBeTruthy();
  });
});

describe('SettingsRow', () => {
  // The row's label is drawn, not wired: the control keeps its own accessible name, so the
  // row must not be a second `<label>` competing for it.
  it('draws the label and description beside the control without relabelling it', () => {
    render(
      <SettingsSection title="Identity">
        <SettingsRow label="Display name" description="Shown when full names are on.">
          <input aria-label="Display name" defaultValue="Ada" />
        </SettingsRow>
      </SettingsSection>,
    );

    expect(screen.getByText('Display name')).toBeTruthy();
    expect(screen.getByText('Shown when full names are on.')).toBeTruthy();
    expect(screen.getByRole('textbox', { name: 'Display name' })).toBeTruthy();
    expect(screen.queryByRole('heading', { level: 3 })).toBeNull();
  });

  it('renders a row with no label as a plain slot for its content', () => {
    render(
      <SettingsRow>
        <table>
          <tbody>
            <tr>
              <td>one</td>
            </tr>
          </tbody>
        </table>
      </SettingsRow>,
    );

    expect(screen.getByRole('table')).toBeTruthy();
  });
});

describe('DangerZoneRow', () => {
  it('draws its own red text action and runs it', async () => {
    const onAction = vi.fn();
    const user = userEvent.setup();
    render(
      <DangerZone>
        <DangerZoneRow
          title="Leave Polaris"
          consequence="You stop being a member."
          actionLabel="Leave workspace"
          onAction={onAction}
        />
      </DangerZone>,
    );

    await user.click(screen.getByRole('button', { name: 'Leave workspace' }));
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  // Busy keeps the button in the tab order and holds focus where the click put it; it is
  // the click that is refused, not the element.
  it('refuses the action while busy without disabling the element', async () => {
    const onAction = vi.fn();
    const user = userEvent.setup();
    render(
      <DangerZone>
        <DangerZoneRow
          title="Delete team"
          consequence="Everything in it goes."
          actionLabel="Delete team"
          onAction={onAction}
          busy
        />
      </DangerZone>,
    );

    const button = screen.getByRole('button', { name: 'Delete team' });
    expect(button.getAttribute('aria-disabled')).toBe('true');
    expect(button.hasAttribute('disabled')).toBe(false);
    await user.click(button);
    expect(onAction).not.toHaveBeenCalled();
  });
});
