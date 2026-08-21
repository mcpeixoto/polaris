/**
 * What arrives, and where.
 *
 * This screen exists because something else already points at it: the digest email's
 * `List-Unsubscribe` header and its footer both link to `/settings/notifications`. A mail
 * that offers a way out and links to a page that does not exist is worse than one that offers
 * nothing — it is the difference between a product that respects the request and one that
 * appears to and does not. The route fell through to the first team's issue list.
 *
 * Every control writes immediately. There is no Save button, because there is nothing here
 * that needs to be true all at once: turning the digest off and muting a type are independent
 * decisions, and a form that batches them would let somebody leave the page believing they
 * had done something they had not.
 *
 * The whole preferences bag goes on every write — see `updateNotificationPrefs`, which
 * explains why — so a key this build does not render survives being here.
 */

import { useEngine } from '~/app/context';
import { Button, Checkbox, EmptyState, Select } from '~/components';
import { report, updateNotificationPrefs } from '~/features/inbox/mutations';
import { requestNotificationPermission } from '~/platform/runtime';
import {
  setCustomerSubscription,
  setInitiativeSubscription,
  setProjectSubscription,
} from '~/features/subscriptions/mutations';
import { setViewSubscription } from '~/features/view/mutations';
import { useLiveQuery } from '~/hooks/useLiveQuery';
import { useViewerId } from '~/hooks/useViewer';
import type { NotificationPrefs, NotificationType } from '~/store';

import styles from './NotificationSettings.module.css';

/**
 * The cadences, in the order somebody scans them.
 *
 * Off first, because it is the reason most people open this screen. The rest ascend by how
 * much mail they produce, which is the axis the reader is actually choosing along.
 */
const CADENCES: readonly {
  readonly value: 'off' | 'hourly' | 'daily' | 'weekly';
  readonly label: string;
}[] = [
  { value: 'off', label: 'Never' },
  { value: 'hourly', label: 'Hourly' },
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
];

/**
 * The notification types, in plain words.
 *
 * Written out rather than derived from the union, because the union's members are database
 * vocabulary — `sub_issue_completed` — and a settings screen that shows those is a settings
 * screen written for the people who built it. A type added to the schema and not to this list
 * simply does not appear here, which is the right failure: an unlabelled switch is worse than
 * a missing one, and the fan-out treats an unmuted type as wanted.
 */
const TYPES: readonly {
  readonly value: NotificationType;
  readonly label: string;
  readonly hint: string;
}[] = [
  {
    value: 'issue_assigned',
    label: 'Issues assigned to me',
    hint: 'Somebody put an issue in your name.',
  },
  {
    value: 'issue_status_changed',
    label: 'Status changes',
    hint: 'An issue you follow moved.',
  },
  {
    value: 'issue_priority_raised',
    label: 'Priority raised',
    hint: 'Only when it goes up. A de-prioritised issue is not news.',
  },
  { value: 'issue_due', label: 'Due dates', hint: 'An issue you follow is due or overdue.' },
  {
    value: 'issue_blocked',
    label: 'Blocked',
    hint: 'Something you follow is now waiting on something else.',
  },
  { value: 'comment', label: 'Comments', hint: 'On an issue you follow.' },
  { value: 'mention', label: 'Mentions', hint: 'Somebody wrote your name.' },
  {
    value: 'sub_issue_completed',
    label: 'Sub-issues completed',
    hint: 'A child of an issue you follow was finished.',
  },
  {
    value: 'view_issue_added',
    label: 'Issues added to a view I follow',
    hint: 'A newly created issue matches a saved view you subscribed to.',
  },
  {
    value: 'view_issue_completed',
    label: 'Issues completed in a view I follow',
    hint: 'An issue that matches a saved view you subscribed to was finished or canceled.',
  },
  {
    value: 'project_issue_added',
    label: 'Issues added to a project I follow',
    hint: 'A newly created issue was put in a project you subscribed to.',
  },
  {
    value: 'project_issue_completed',
    label: 'Issues completed in a project I follow',
    hint: 'An issue in a project you subscribed to was finished or canceled.',
  },
  {
    value: 'project_update',
    label: 'Project updates',
    hint: 'A new status update was posted on a project you subscribed to.',
  },
  {
    value: 'initiative_issue_added',
    label: 'Issues added to an initiative I follow',
    hint: 'A newly created issue was put in a project linked to an initiative you subscribed to.',
  },
  {
    value: 'initiative_issue_completed',
    label: 'Issues completed in an initiative I follow',
    hint: 'An issue in a linked project of an initiative you subscribed to was finished or canceled.',
  },
  {
    value: 'initiative_update',
    label: 'Initiative updates',
    hint: 'A new status update was posted on an initiative you subscribed to.',
  },
  {
    value: 'customer_request_added',
    label: 'Requests added for a customer I follow',
    hint: 'A request was attributed to a customer you subscribed to.',
  },
  {
    value: 'customer_request_important',
    label: 'Requests marked important',
    hint: 'A request for a customer you subscribed to was marked important.',
  },
  {
    value: 'customer_request_completed',
    label: 'Requests completed for a customer I follow',
    hint: 'The issue linked to a request for a customer you subscribed to was finished or canceled.',
  },
  {
    value: 'pulse_digest',
    label: 'Pulse digest',
    hint: 'A morning summary of project updates on work you lead, created, or belong to.',
  },
];

export function NotificationSettings() {
  const engine = useEngine();
  const viewerId = useViewerId();

  const prefs = useLiveQuery(
    (store) => (viewerId === null ? null : (store.users.get(viewerId)?.notificationPrefs ?? {})),
    ['user'],
    [viewerId],
  );

  const watches = useLiveQuery(
    (store) => {
      if (viewerId === null) return [];
      const rows: {
        readonly id: string;
        readonly viewId: string;
        readonly name: string;
        readonly added: boolean;
        readonly completed: boolean;
      }[] = [];
      for (const sub of store.viewSubscriptions.values()) {
        if (sub.userId !== viewerId) continue;
        rows.push({
          id: sub.id,
          viewId: sub.viewId,
          name: store.get('view', sub.viewId)?.name ?? 'Deleted view',
          added: sub.added,
          completed: sub.completed,
        });
      }
      rows.sort((a, b) => a.name.localeCompare(b.name));
      return rows;
    },
    ['viewSubscription', 'view'],
    [viewerId],
  );

  const projectWatches = useLiveQuery(
    (store) => {
      if (viewerId === null) return [];
      const rows: {
        readonly id: string;
        readonly projectId: string;
        readonly name: string;
        readonly issuesAdded: boolean;
        readonly issuesCompleted: boolean;
        readonly updates: boolean;
      }[] = [];
      for (const sub of store.projectSubscriptions.values()) {
        if (sub.userId !== viewerId) continue;
        rows.push({
          id: sub.id,
          projectId: sub.projectId,
          name: store.get('project', sub.projectId)?.name ?? 'Deleted project',
          issuesAdded: sub.issuesAdded,
          issuesCompleted: sub.issuesCompleted,
          updates: sub.updates,
        });
      }
      rows.sort((a, b) => a.name.localeCompare(b.name));
      return rows;
    },
    ['projectSubscription', 'project'],
    [viewerId],
  );

  const initiativeWatches = useLiveQuery(
    (store) => {
      if (viewerId === null) return [];
      const rows: {
        readonly id: string;
        readonly initiativeId: string;
        readonly name: string;
        readonly issuesAdded: boolean;
        readonly issuesCompleted: boolean;
        readonly updates: boolean;
      }[] = [];
      for (const sub of store.initiativeSubscriptions.values()) {
        if (sub.userId !== viewerId) continue;
        rows.push({
          id: sub.id,
          initiativeId: sub.initiativeId,
          name: store.get('initiative', sub.initiativeId)?.name ?? 'Deleted initiative',
          issuesAdded: sub.issuesAdded,
          issuesCompleted: sub.issuesCompleted,
          updates: sub.updates,
        });
      }
      rows.sort((a, b) => a.name.localeCompare(b.name));
      return rows;
    },
    ['initiativeSubscription', 'initiative'],
    [viewerId],
  );

  const customerWatches = useLiveQuery(
    (store) => {
      if (viewerId === null) return [];
      const rows: {
        readonly id: string;
        readonly customerId: string;
        readonly name: string;
        readonly requestAdded: boolean;
        readonly requestImportant: boolean;
        readonly requestCompleted: boolean;
      }[] = [];
      for (const sub of store.customerSubscriptions.values()) {
        if (sub.userId !== viewerId) continue;
        rows.push({
          id: sub.id,
          customerId: sub.customerId,
          name: store.get('customer', sub.customerId)?.name ?? 'Deleted customer',
          requestAdded: sub.requestAdded,
          requestImportant: sub.requestImportant,
          requestCompleted: sub.requestCompleted,
        });
      }
      rows.sort((a, b) => a.name.localeCompare(b.name));
      return rows;
    },
    ['customerSubscription', 'customer'],
    [viewerId],
  );

  if (viewerId === null || prefs === null) {
    return (
      <div className={styles.screen}>
        <EmptyState
          title="Loading your preferences"
          description="This needs to know who you are, which arrives a moment after the workspace does."
        />
      </div>
    );
  }

  const write = (patch: NotificationPrefs) => {
    updateNotificationPrefs(engine, viewerId, patch).catch(report);
  };

  const muted = new Set(prefs.muted ?? []);
  const cadence = prefs.emailDigest ?? 'daily';

  const setMuted = (type: NotificationType, isMuted: boolean) => {
    const next = new Set(muted);
    if (isMuted) next.add(type);
    else next.delete(type);
    write({ muted: [...next] });
  };

  return (
    <div className={styles.screen}>
      <header className={styles.header}>
        <h1 className={styles.title}>Notifications</h1>
      </header>

      <div className={styles.body}>
        <section className={styles.section} aria-labelledby="desktop-heading">
          <h2 className={styles.sectionTitle} id="desktop-heading">
            Desktop
          </h2>
          <p className={styles.sectionNote}>
            Browser notifications for new inbox items. The tab badge still updates either way.
          </p>
          <Checkbox
            checked={prefs.desktop === true}
            onChange={(event) => {
              const on = event.target.checked;
              if (!on) {
                write({ desktop: false });
                return;
              }
              void requestNotificationPermission().then((granted) => {
                if (granted) write({ desktop: true });
              });
            }}
            label="Browser notifications"
          />
          {prefs.desktop === true ? (
            <p className={styles.warning}>
              New unread items also appear as a system notification once this page has permission.
            </p>
          ) : null}
        </section>

        <section className={styles.section} aria-labelledby="email-heading">
          <h2 className={styles.sectionTitle} id="email-heading">
            Email
          </h2>
          <p className={styles.sectionNote}>
            Everything still arrives in your inbox here. This is only about what is also sent to you
            by email.
          </p>

          <div className={styles.field}>
            <Select
              label="Digest"
              hint="One message summarising what happened, rather than one per event."
              value={cadence}
              onChange={(event) =>
                write({ emailDigest: event.target.value as NotificationPrefs['emailDigest'] })
              }
            >
              {CADENCES.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </div>

          <Checkbox
            checked={prefs.emailPerNotification === true}
            onChange={(event) => write({ emailPerNotification: event.target.checked })}
            label="Email me for every notification"
          />
          {/* Said plainly rather than left to be discovered. This is the switch that turns a
              quiet product into a noisy one, and somebody turning it on should know that
              before their inbox tells them. */}
          <p className={styles.warning}>
            One message per event. On a busy team this is a great deal of mail.
          </p>
        </section>

        <section className={styles.section} aria-labelledby="types-heading">
          <h2 className={styles.sectionTitle} id="types-heading">
            What to notify me about
          </h2>
          <p className={styles.sectionNote}>
            Switching one off stops it entirely — it will not reach your inbox here either, and it
            cannot reach an email. You stay subscribed to the issue.
          </p>

          <ul className={styles.types}>
            {TYPES.map((type) => (
              <li key={type.value} className={styles.type}>
                <Checkbox
                  checked={!muted.has(type.value)}
                  onChange={(event) => setMuted(type.value, !event.target.checked)}
                  label={type.label}
                />
                <span className={styles.typeHint}>{type.hint}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className={styles.section} aria-labelledby="views-heading">
          <h2 className={styles.sectionTitle} id="views-heading">
            Saved views you follow
          </h2>
          <p className={styles.sectionNote}>
            Subscribe from a saved view’s header. Turning both kinds of event off here is the same
            as unsubscribing.
          </p>
          {watches.length === 0 ? (
            <p className={styles.warning}>You are not watching any saved views.</p>
          ) : (
            <ul className={styles.types}>
              {watches.map((watch) => (
                <li key={watch.id} className={styles.watch}>
                  <div className={styles.watchMeta}>
                    <span>{watch.name}</span>
                    <span className={styles.typeHint}>
                      {[
                        watch.added ? 'issues added' : null,
                        watch.completed ? 'issues completed' : null,
                      ]
                        .filter(Boolean)
                        .join(', ')}
                    </span>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setViewSubscription(engine, {
                        viewId: watch.viewId,
                        userId: viewerId,
                        added: false,
                        completed: false,
                      }).catch(report);
                    }}
                  >
                    Unsubscribe
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className={styles.section} aria-labelledby="projects-heading">
          <h2 className={styles.sectionTitle} id="projects-heading">
            Projects you follow
          </h2>
          <p className={styles.sectionNote}>
            Subscribe from a project’s header. Turning every event off here is the same as
            unsubscribing.
          </p>
          {projectWatches.length === 0 ? (
            <p className={styles.warning}>You are not watching any projects.</p>
          ) : (
            <ul className={styles.types}>
              {projectWatches.map((watch) => (
                <li key={watch.id} className={styles.watch}>
                  <div className={styles.watchMeta}>
                    <span>{watch.name}</span>
                    <span className={styles.typeHint}>
                      {[
                        watch.issuesAdded ? 'issues added' : null,
                        watch.issuesCompleted ? 'issues completed' : null,
                        watch.updates ? 'updates' : null,
                      ]
                        .filter(Boolean)
                        .join(', ')}
                    </span>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setProjectSubscription(engine, {
                        projectId: watch.projectId,
                        userId: viewerId,
                        issuesAdded: false,
                        issuesCompleted: false,
                        updates: false,
                      }).catch(report);
                    }}
                  >
                    Unsubscribe
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className={styles.section} aria-labelledby="initiatives-heading">
          <h2 className={styles.sectionTitle} id="initiatives-heading">
            Initiatives you follow
          </h2>
          <p className={styles.sectionNote}>
            Subscribe from an initiative’s header. Turning every event off here is the same as
            unsubscribing.
          </p>
          {initiativeWatches.length === 0 ? (
            <p className={styles.warning}>You are not watching any initiatives.</p>
          ) : (
            <ul className={styles.types}>
              {initiativeWatches.map((watch) => (
                <li key={watch.id} className={styles.watch}>
                  <div className={styles.watchMeta}>
                    <span>{watch.name}</span>
                    <span className={styles.typeHint}>
                      {[
                        watch.issuesAdded ? 'issues added' : null,
                        watch.issuesCompleted ? 'issues completed' : null,
                        watch.updates ? 'updates' : null,
                      ]
                        .filter(Boolean)
                        .join(', ')}
                    </span>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setInitiativeSubscription(engine, {
                        initiativeId: watch.initiativeId,
                        userId: viewerId,
                        issuesAdded: false,
                        issuesCompleted: false,
                        updates: false,
                      }).catch(report);
                    }}
                  >
                    Unsubscribe
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className={styles.section} aria-labelledby="customers-heading">
          <h2 className={styles.sectionTitle} id="customers-heading">
            Customers you follow
          </h2>
          <p className={styles.sectionNote}>
            Subscribe from a customer’s page. Turning every event off here is the same as
            unsubscribing.
          </p>
          {customerWatches.length === 0 ? (
            <p className={styles.warning}>You are not watching any customers.</p>
          ) : (
            <ul className={styles.types}>
              {customerWatches.map((watch) => (
                <li key={watch.id} className={styles.watch}>
                  <div className={styles.watchMeta}>
                    <span>{watch.name}</span>
                    <span className={styles.typeHint}>
                      {[
                        watch.requestAdded ? 'requests added' : null,
                        watch.requestImportant ? 'marked important' : null,
                        watch.requestCompleted ? 'requests completed' : null,
                      ]
                        .filter(Boolean)
                        .join(', ')}
                    </span>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setCustomerSubscription(engine, {
                        customerId: watch.customerId,
                        userId: viewerId,
                        requestAdded: false,
                        requestImportant: false,
                        requestCompleted: false,
                      }).catch(report);
                    }}
                  >
                    Unsubscribe
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
