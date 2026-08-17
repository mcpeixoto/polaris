/**
 * The inbox's GraphQL.
 *
 * The inbox is the one replicated entity the bootstrap snapshot does not carry. Look at
 * `StreamBootstrap` in services/internal/domain/sync.go: it streams the workspace, users,
 * teams, memberships, workflow states, issues and comments, and stops. Notifications reach
 * a client only as user-scoped deltas after the socket is up — so a browser that has just
 * bootstrapped has an empty inbox and an empty badge until something new happens, which is
 * the exact moment a user opens the app to find out what they missed.
 *
 * `INBOX_QUERY` is therefore not an optimisation and not a fallback: it is how the replica
 * comes to hold an inbox at all. It runs once per session, its rows are merged into the
 * store, and everything after that is deltas. See `hydrateInbox`.
 *
 * The mutations are the other half. They go through `engine.mutate` like every other write
 * in the client, so the row changes on the keystroke and the request follows.
 */

import { USER_FIELDS } from '~/gql/operations';

/**
 * Every field of a notification, matching the shape the delta stream carries.
 *
 * It has to match exactly, because a hydrated row and a streamed row land in the same map
 * under the same id: a fragment missing `groupKey` would produce a row that renders
 * correctly today and loses its coalescing count the moment a delta replaces it.
 */
export const NOTIFICATION_FIELDS = /* GraphQL */ `
  fragment NotificationFields on Notification {
    id
    workspaceId
    userId
    type
    issueId
    commentId
    actor {
      type
      id
    }
    changeVersion
    groupKey
    count
    payload
    readAt
    snoozedUntil
    createdAt
    updatedAt
  }
`;

/**
 * One page of the inbox, read and snoozed rows included.
 *
 * Both flags are on deliberately. The server excludes snoozed rows from its own default
 * because it is answering "what should this person see now", and the client is answering a
 * different question: a snooze expires because the clock moved rather than because anything
 * was written, so a client that had not been sent the row could not make it reappear when
 * the time came. Read rows come across for the same reason — the inbox lets you look back
 * at what you have already dealt with, and a row the replica never received cannot be shown.
 */
export const INBOX_QUERY = /* GraphQL */ `
  ${NOTIFICATION_FIELDS}
  query Inbox($first: Int!) {
    notifications(includeRead: true, includeSnoozed: true, first: $first) {
      ...NotificationFields
    }
  }
`;

/**
 * The server's unread count.
 *
 * Deliberately not what the sidebar badge reads. A count fetched over the network is stale
 * the instant the next delta lands, and the badge is the one number in the product that has
 * to be right at all times — so it is derived from the store's unread index instead, which
 * moves in the same frame as the change that moved it. See UnreadBadge.
 *
 * It stays here because it is part of the API this milestone exposes, and because a client
 * without a replica — an integration, a mobile shell — has no other way to ask.
 */
export const UNREAD_NOTIFICATION_COUNT_QUERY = /* GraphQL */ `
  query UnreadNotificationCount {
    unreadNotificationCount
  }
`;

export const MARK_NOTIFICATION_READ = /* GraphQL */ `
  ${NOTIFICATION_FIELDS}
  mutation MarkNotificationRead($id: UUID!, $read: Boolean!) {
    markNotificationRead(id: $id, read: $read) {
      version
      notification {
        ...NotificationFields
      }
    }
  }
`;

/**
 * The whole inbox in one mutation.
 *
 * One statement rather than one per row, and the server says why: marking a thousand rows
 * read individually would mint a thousand workspace versions and hold the version lock for
 * the length of all of them — a write pause for everybody in the workspace, caused by one
 * person pressing a key.
 */
export const MARK_ALL_NOTIFICATIONS_READ = /* GraphQL */ `
  ${NOTIFICATION_FIELDS}
  mutation MarkAllNotificationsRead {
    markAllNotificationsRead {
      version
      notifications {
        ...NotificationFields
      }
    }
  }
`;

/** A null `until` wakes the row now, which is how un-snoozing is expressed. */
export const SNOOZE_NOTIFICATION = /* GraphQL */ `
  ${NOTIFICATION_FIELDS}
  mutation SnoozeNotification($id: UUID!, $until: Time) {
    snoozeNotification(id: $id, until: $until) {
      version
      notification {
        ...NotificationFields
      }
    }
  }
`;

export const DELETE_NOTIFICATION = /* GraphQL */ `
  mutation DeleteNotification($id: UUID!) {
    deleteNotification(id: $id) {
      version
      id
    }
  }
`;

/**
 * Writes the whole preferences bag.
 *
 * Whole rather than per-key, which is the API's shape: `updateNotificationPrefs(prefs: JSON!)`
 * replaces what is stored. The screen therefore has to send everything it knows, including
 * keys it does not render — a client built before a preference existed must not delete that
 * preference by saving the ones it does understand. See `NotificationPrefs` in the store's
 * types for the bag, and services/internal/domain/notification_prefs.go for the one Go
 * definition of it.
 */
export const UPDATE_NOTIFICATION_PREFS = /* GraphQL */ `
  ${USER_FIELDS}
  mutation UpdateNotificationPrefs($prefs: JSON!) {
    updateNotificationPrefs(prefs: $prefs) {
      version
      user {
        ...UserFields
      }
    }
  }
`;
