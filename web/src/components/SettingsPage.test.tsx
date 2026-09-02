import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { DangerZone, DangerZoneRow } from './DangerZone';
import { SettingsPage } from './SettingsPage';
import { SettingsSection } from './SettingsSection';

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
