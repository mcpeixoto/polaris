/**
 * The badge in the corner of an inbox row's avatar: what kind of thing happened.
 *
 * The sentence beside it already says so in words, so this is decorative — a reader
 * scanning down the column sees a run of comment bubbles and a lone check without reading a
 * line. Every `NotificationType` maps to a glyph, and a type this build has not heard of
 * falls back to the bell, for the same reason `describeEvent` falls back to "updated": a
 * newer server can deliver one, and a blank badge reads as a rendering fault.
 *
 * Twelve-pixel line drawings inside a sixteen-pixel disc, 1.5px stroke.
 */

import type { ReactElement } from 'react';

import type { NotificationType } from '~/store';

const STROKE = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.5,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const;

const check = (
  <svg viewBox="0 0 16 16" {...STROKE} aria-hidden="true">
    <path d="m3.5 8.5 3 3 6-6.5" />
  </svg>
);
const plus = (
  <svg viewBox="0 0 16 16" {...STROKE} aria-hidden="true">
    <path d="M8 3.5v9M3.5 8h9" />
  </svg>
);
const comment = (
  <svg viewBox="0 0 16 16" {...STROKE} aria-hidden="true">
    <path d="M3 3.5h10v7H7.5L4.5 13v-2.5H3z" />
  </svg>
);
const mention = (
  <svg viewBox="0 0 16 16" {...STROKE} aria-hidden="true">
    <circle cx="8" cy="8" r="2.25" />
    <path d="M10.25 8v1a1.5 1.5 0 0 0 3 0V8a5.25 5.25 0 1 0-2.2 4.28" />
  </svg>
);
const person = (
  <svg viewBox="0 0 16 16" {...STROKE} aria-hidden="true">
    <circle cx="8" cy="5.5" r="2.5" />
    <path d="M3.5 13.5a4.5 4.5 0 0 1 9 0" />
  </svg>
);
const status = (
  <svg viewBox="0 0 16 16" {...STROKE} aria-hidden="true">
    <circle cx="8" cy="8" r="4.75" />
    <path d="M8 3.25A4.75 4.75 0 0 1 8 12.75z" fill="currentColor" stroke="none" />
  </svg>
);
const priority = (
  <svg viewBox="0 0 16 16" {...STROKE} aria-hidden="true">
    <path d="M8 12.5v-9m-4 4 4-4 4 4" />
  </svg>
);
const clock = (
  <svg viewBox="0 0 16 16" {...STROKE} aria-hidden="true">
    <circle cx="8" cy="8" r="4.75" />
    <path d="M8 5.5V8l2 1.5" />
  </svg>
);
const blocked = (
  <svg viewBox="0 0 16 16" {...STROKE} aria-hidden="true">
    <circle cx="8" cy="8" r="4.75" />
    <path d="m4.75 4.75 6.5 6.5" />
  </svg>
);
const update = (
  <svg viewBox="0 0 16 16" {...STROKE} aria-hidden="true">
    <path d="M3.5 3.5h9v9h-9zM6 6.5h4M6 9.5h2.5" />
  </svg>
);
const pulse = (
  <svg viewBox="0 0 16 16" {...STROKE} aria-hidden="true">
    <path d="M2.5 8h2.5l1.5-3.5 2.5 7 1.5-3.5h3" />
  </svg>
);
const request = (
  <svg viewBox="0 0 16 16" {...STROKE} aria-hidden="true">
    <path d="M3.5 3.5h5l4 4-4.5 4.5-4.5-4.5z" />
    <circle cx="6.25" cy="6.25" r="0.5" fill="currentColor" />
  </svg>
);
const bell = (
  <svg viewBox="0 0 16 16" {...STROKE} aria-hidden="true">
    <path d="M4.5 10.5V7.75a3.5 3.5 0 0 1 7 0v2.75l1 1.25h-9zM6.75 13a1.25 1.25 0 0 0 2.5 0" />
  </svg>
);

const GLYPHS: Readonly<Record<NotificationType, ReactElement>> = {
  issue_assigned: person,
  issue_status_changed: status,
  issue_priority_raised: priority,
  issue_due: clock,
  issue_blocked: blocked,
  comment,
  mention,
  sub_issue_completed: check,
  view_issue_added: plus,
  view_issue_completed: check,
  pulse_digest: pulse,
  project_issue_added: plus,
  project_issue_completed: check,
  project_update: update,
  initiative_issue_added: plus,
  initiative_issue_completed: check,
  initiative_update: update,
  customer_request_added: request,
  customer_request_important: priority,
  customer_request_completed: check,
};

/** Every type this build knows, exported so a test can prove none is missing a glyph. */
export const GLYPH_TYPES = Object.keys(GLYPHS) as readonly NotificationType[];

export function notificationGlyph(type: NotificationType): ReactElement {
  return GLYPHS[type] ?? bell;
}
