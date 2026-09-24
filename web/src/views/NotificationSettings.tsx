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

import { useEffect, useState } from 'react';

import { useEngine } from '~/app/context';
import { Button, Checkbox, EmptyState, Select } from '~/components';
import { report, updateNotificationPrefs } from '~/features/inbox/mutations';
import {
  DEFAULT_PUSH,
  disableThisDevice,
  enableThisDevice,
  pushAvailability,
  thisDeviceEndpoint,
} from '~/features/inbox/push';
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
  {
    value: 'issue_due',
    label: 'Due dates',
    hint: 'Assigned to you — or, with nobody assigned, an issue you follow. The morning it is due, and once the morning after.',
  },
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
];

export function NotificationSettings() {
  const engine = useEngine();
  const viewerId = useViewerId();

  const prefs = useLiveQuery(
    (store) => (viewerId === null ? null : (store.users.get(viewerId)?.notificationPrefs ?? {})),
    ['user'],
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
  const phone: readonly NotificationType[] = prefs.push === undefined ? DEFAULT_PUSH : prefs.push;

  const setMuted = (type: NotificationType, isMuted: boolean) => {
    const next = new Set(muted);
    if (isMuted) next.add(type);
    else next.delete(type);
    write({ muted: [...next] });
  };

  // An explicit list, never "back to undefined". Undefined is the person who has never
  // touched the phone, and a toggle is them touching it — including turning the last
  // type off, which has to be stored as an empty array or the default would come back.
  const setPhone = (type: NotificationType, on: boolean) => {
    const next = new Set<NotificationType>(phone);
    if (on) next.add(type);
    else next.delete(type);
    write({ push: [...next] });
  };

  return (
    <div className={styles.screen}>
      <header className={styles.header}>
        <h1 className={styles.title}>Notifications</h1>
      </header>

      <div className={styles.body}>
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

        <PhoneSection muted={muted} phone={phone} onToggle={setPhone} />

        <section className={styles.section} aria-labelledby="types-heading">
          <h2 className={styles.sectionTitle} id="types-heading">
            What to notify me about
          </h2>
          <p className={styles.sectionNote}>
            Switching one off stops it entirely — it will not reach your inbox here, an email, or
            your phone. You stay subscribed to the issue.
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
      </div>
    </div>
  );
}

/**
 * This device, as distinct from which types it should hear.
 *
 * The subscription is local state: the replica does not carry device credentials, so
 * there is nothing in the store to read. Looking it up is a call to the browser, and
 * it waits until after paint so a settings screen in a test never touches the network.
 */
function PhoneSection({
  muted,
  phone,
  onToggle,
}: {
  muted: ReadonlySet<NotificationType>;
  phone: readonly NotificationType[];
  onToggle: (type: NotificationType, on: boolean) => void;
}) {
  const availability = pushAvailability();
  const [endpoint, setEndpoint] = useState<string | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [deviceError, setDeviceError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    thisDeviceEndpoint()
      .then((current) => {
        if (!cancelled) setEndpoint(current);
      })
      .catch(() => {
        if (!cancelled) setEndpoint(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const on = endpoint !== null && endpoint !== undefined;

  const toggle = () => {
    setBusy(true);
    setDeviceError(null);
    const action = on ? disableThisDevice().then(() => null) : enableThisDevice();
    action
      .then((next) => setEndpoint(next))
      .catch((error: unknown) => {
        setDeviceError(
          error instanceof Error ? error.message : 'This device could not be registered.',
        );
      })
      .finally(() => setBusy(false));
  };

  return (
    <section className={styles.section} aria-labelledby="phone-heading">
      <h2 className={styles.sectionTitle} id="phone-heading">
        iPhone and browser
      </h2>
      <p className={styles.sectionNote}>
        Quieter than the inbox. On an iPhone this only works after you add Polaris to the Home
        Screen and open it from there, over HTTPS. A tap here is what asks the device for permission
        — a tab in Safari cannot receive these.
      </p>
      {availability.needsHomeScreen ? (
        <p className={styles.sectionNote}>
          This iPhone is still in Safari. Add Polaris to the Home Screen, open it from the icon, and
          come back to this page.
        </p>
      ) : null}
      {availability.supported ? (
        <Button
          variant="secondary"
          loading={busy}
          disabled={endpoint === undefined || availability.needsHomeScreen}
          onClick={toggle}
        >
          {on ? 'Turn off this device' : 'Turn on this device'}
        </Button>
      ) : (
        <p className={styles.sectionNote}>This browser cannot receive notifications.</p>
      )}
      {deviceError === null ? null : (
        <p className={styles.warning} role="alert">
          {deviceError}
        </p>
      )}
      <p className={styles.sectionNote}>
        The ones that start on are what a phone hears until you change them. A type switched off
        below never reaches the phone, even if it stays selected here.
      </p>
      <ul className={styles.types}>
        {TYPES.map((type) => {
          const isMuted = muted.has(type.value);
          return (
            <li key={type.value} className={styles.type}>
              <Checkbox
                checked={!isMuted && phone.includes(type.value)}
                disabled={isMuted}
                onChange={(event) => onToggle(type.value, event.target.checked)}
                label={type.label}
              />
            </li>
          );
        })}
      </ul>
    </section>
  );
}
