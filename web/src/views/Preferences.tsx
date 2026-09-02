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

import { Checkbox, Select } from '~/components';
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
import styles from './Preferences.module.css';

export function Preferences() {
  const prefs = useSyncExternalStore(subscribePrefs, getPrefs, getPrefs);

  const write = useCallback((patch: Partial<Preferences>) => {
    const next = setPrefs(patch);
    if (patch.theme !== undefined) applyTheme(patch.theme);
    applyPrefs(next);
  }, []);

  return (
    <div className={styles.screen}>
      <header className={styles.header}>
        <h1 className={styles.title}>Preferences</h1>
      </header>

      <div className={styles.body}>
        <section className={styles.section} aria-labelledby="general-heading">
          <h2 className={styles.sectionTitle} id="general-heading">
            General
          </h2>
          <p className={styles.sectionNote}>
            Where you land, how people are named, and which key posts a comment.
          </p>

          <div className={styles.field}>
            <Select
              label="Default home view"
              hint="Opened on launch. Favourites still live in the sidebar."
              value={prefs.homeView}
              onChange={(event) => write({ homeView: event.target.value as HomeView })}
            >
              <option value="team">First team’s issues</option>
              <option value="my-issues">My issues</option>
              <option value="inbox">Inbox</option>
              <option value="drafts">Drafts</option>
            </Select>
          </div>

          <Checkbox
            checked={prefs.fullNames}
            onChange={(event) => write({ fullNames: event.target.checked })}
            label="Show full names"
          />
          <p className={styles.hint}>
            Off uses usernames. Mentions and the assignee picker follow this.
          </p>

          <div className={styles.field}>
            <Select
              label="First day of the week"
              value={prefs.weekStartsOn}
              onChange={(event) => write({ weekStartsOn: event.target.value as WeekStart })}
            >
              <option value="monday">Monday</option>
              <option value="sunday">Sunday</option>
            </Select>
          </div>

          <Checkbox
            checked={prefs.convertEmoticons}
            onChange={(event) => write({ convertEmoticons: event.target.checked })}
            label="Convert text emoticons into emoji"
          />
          <p className={styles.hint}>
            Turns <code>:)</code> into 🙂 in comments. Off by default so a code review that wrote
            those characters keeps them.
          </p>

          <div className={styles.field}>
            <Select
              label="Comment submit key"
              hint="⌘⏎ always works. Enter is a preference for people who never want a newline."
              value={prefs.commentSubmit}
              onChange={(event) => write({ commentSubmit: event.target.value as CommentSubmit })}
            >
              <option value="mod-enter">⌘⏎ / Ctrl+Enter</option>
              <option value="enter">Enter</option>
            </Select>
          </div>
        </section>

        <section className={styles.section} aria-labelledby="theme-heading">
          <h2 className={styles.sectionTitle} id="theme-heading">
            Interface
          </h2>
          <p className={styles.sectionNote}>Theme, type size, and how links and pointers look.</p>

          <div className={styles.field}>
            <Select
              label="Theme"
              value={prefs.theme}
              onChange={(event) => write({ theme: event.target.value as ThemeName })}
            >
              <option value="system">System</option>
              <option value="dark">Dark</option>
              <option value="light">Light</option>
            </Select>
          </div>

          <div className={styles.field}>
            <Select
              label="Font size"
              value={prefs.fontSize}
              onChange={(event) => write({ fontSize: event.target.value as FontSize })}
            >
              <option value="small">Small</option>
              <option value="default">Default</option>
              <option value="large">Large</option>
            </Select>
          </div>

          <Checkbox
            checked={prefs.pointerCursor}
            onChange={(event) => write({ pointerCursor: event.target.checked })}
            label="Pointer cursor on buttons and links"
          />
          <Checkbox
            checked={prefs.underlineLinks}
            onChange={(event) => write({ underlineLinks: event.target.checked })}
            label="Underline links"
          />
        </section>

        <section className={styles.section} aria-labelledby="auto-heading">
          <h2 className={styles.sectionTitle} id="auto-heading">
            Automations
          </h2>
          <p className={styles.sectionNote}>
            There is no workspace-wide default assignee. These two habits cover the cases people
            actually ask for.
          </p>

          <Checkbox
            checked={prefs.autoAssignOnCreate}
            onChange={(event) => write({ autoAssignOnCreate: event.target.checked })}
            label="Assign issues I create to myself"
          />
          <Checkbox
            checked={prefs.autoAssignOnStart}
            onChange={(event) => write({ autoAssignOnStart: event.target.checked })}
            label="Assign to myself when I move an issue to started"
          />
        </section>
      </div>
    </div>
  );
}
