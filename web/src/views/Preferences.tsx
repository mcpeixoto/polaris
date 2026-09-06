/**
 * How this client should behave: home view, names, theme, the comment submit key, and
 * the two auto-assign habits.
 *
 * Every control writes immediately. There is no Save button, because nothing here needs
 * to be true all at once — turning auto-assign on and picking a theme are independent
 * decisions, and a form that batches them would let somebody leave believing they had
 * done something they had not.
 *
 * These live on the device, next to the theme. Saved drafts and workspace membership
 * follow the account; a comment-submit habit does not.
 */

import { useCallback, useSyncExternalStore } from 'react';

import { Checkbox, Select, SettingsPage, SettingsSection } from '~/components';
import { SettingsRow } from '~/components/SettingsSection';
import {
  applyPrefs,
  getPrefs,
  setPrefs,
  subscribePrefs,
  type CommentSubmit,
  type FontSize,
  type HomeView,
  type Preferences,
  type WeekStart,
} from '~/features/prefs/prefs';
import { applyTheme, type ThemeName } from '~/styles/theme';

export function Preferences() {
  const prefs = useSyncExternalStore(subscribePrefs, getPrefs, getPrefs);

  const write = useCallback((patch: Partial<Preferences>) => {
    const next = setPrefs(patch);
    if (patch.theme !== undefined) applyTheme(patch.theme);
    applyPrefs(next);
  }, []);

  return (
    <SettingsPage
      title="Preferences"
      description="How this client behaves on this device. Nothing here leaves it."
    >
      <SettingsSection
        title="General"
        description="Where you land, how people are named, and which key posts a comment."
      >
        <SettingsRow
          label="Default home view"
          description="Opened on launch. Favourites still live in the sidebar."
          wide
        >
          <Select
            label="Default home view"
            hideLabel
            value={prefs.homeView}
            onChange={(event) => write({ homeView: event.target.value as HomeView })}
          >
            <option value="team">First team’s issues</option>
            <option value="my-issues">My issues</option>
            <option value="inbox">Inbox</option>
            <option value="drafts">Drafts</option>
          </Select>
        </SettingsRow>

        <SettingsRow
          label="Show full names"
          description="Off uses usernames. Mentions and the assignee picker follow this."
        >
          <Checkbox
            aria-label="Show full names"
            checked={prefs.fullNames}
            onChange={(event) => write({ fullNames: event.target.checked })}
          />
        </SettingsRow>

        <SettingsRow label="First day of the week" wide>
          <Select
            label="First day of the week"
            hideLabel
            value={prefs.weekStartsOn}
            onChange={(event) => write({ weekStartsOn: event.target.value as WeekStart })}
          >
            <option value="monday">Monday</option>
            <option value="sunday">Sunday</option>
          </Select>
        </SettingsRow>

        <SettingsRow
          label="Convert text emoticons into emoji"
          description={
            <>
              Turns <code>:)</code> into 🙂 in comments. Off by default so a code review that wrote
              those characters keeps them.
            </>
          }
        >
          <Checkbox
            aria-label="Convert text emoticons into emoji"
            checked={prefs.convertEmoticons}
            onChange={(event) => write({ convertEmoticons: event.target.checked })}
          />
        </SettingsRow>

        <SettingsRow
          label="Comment submit key"
          description="⌘⏎ always works. Enter is a preference for people who never want a newline."
          wide
        >
          <Select
            label="Comment submit key"
            hideLabel
            value={prefs.commentSubmit}
            onChange={(event) => write({ commentSubmit: event.target.value as CommentSubmit })}
          >
            <option value="mod-enter">⌘⏎ / Ctrl+Enter</option>
            <option value="enter">Enter</option>
          </Select>
        </SettingsRow>
      </SettingsSection>

      <SettingsSection
        title="Interface"
        description="Theme, type size, and how links and pointers look."
      >
        <SettingsRow label="Theme" wide>
          <Select
            label="Theme"
            hideLabel
            value={prefs.theme}
            onChange={(event) => write({ theme: event.target.value as ThemeName })}
          >
            <option value="system">System</option>
            <option value="dark">Dark</option>
            <option value="light">Light</option>
          </Select>
        </SettingsRow>

        <SettingsRow label="Font size" wide>
          <Select
            label="Font size"
            hideLabel
            value={prefs.fontSize}
            onChange={(event) => write({ fontSize: event.target.value as FontSize })}
          >
            <option value="small">Small</option>
            <option value="default">Default</option>
            <option value="large">Large</option>
          </Select>
        </SettingsRow>

        <SettingsRow label="Pointer cursor on buttons and links">
          <Checkbox
            aria-label="Pointer cursor on buttons and links"
            checked={prefs.pointerCursor}
            onChange={(event) => write({ pointerCursor: event.target.checked })}
          />
        </SettingsRow>

        <SettingsRow label="Underline links">
          <Checkbox
            aria-label="Underline links"
            checked={prefs.underlineLinks}
            onChange={(event) => write({ underlineLinks: event.target.checked })}
          />
        </SettingsRow>
      </SettingsSection>

      <SettingsSection
        title="Automations"
        description="There is no workspace-wide default assignee. These two habits cover the cases people actually ask for."
      >
        <SettingsRow label="Assign issues I create to myself">
          <Checkbox
            aria-label="Assign issues I create to myself"
            checked={prefs.autoAssignOnCreate}
            onChange={(event) => write({ autoAssignOnCreate: event.target.checked })}
          />
        </SettingsRow>

        <SettingsRow label="Assign to myself when I move an issue to started">
          <Checkbox
            aria-label="Assign to myself when I move an issue to started"
            checked={prefs.autoAssignOnStart}
            onChange={(event) => write({ autoAssignOnStart: event.target.checked })}
          />
        </SettingsRow>
      </SettingsSection>
    </SettingsPage>
  );
}
