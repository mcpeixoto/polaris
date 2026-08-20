/**
 * Cycle calendar subscription. The replica knows a feed exists; the token lives
 * only in the URL returned here, minted on first Subscribe and replaced on Rotate.
 */

import { gql } from '~/sync/api';

export const ENSURE_CYCLE_CALENDAR_FEED = /* GraphQL */ `
  mutation EnsureCycleCalendarFeed($teamId: UUID!) {
    ensureCycleCalendarFeed(teamId: $teamId) {
      version
      url
      cycleCalendarFeed {
        id
        workspaceId
        teamId
        userId
        createdAt
        updatedAt
      }
    }
  }
`;

export const ROTATE_CYCLE_CALENDAR_FEED = /* GraphQL */ `
  mutation RotateCycleCalendarFeed($teamId: UUID!) {
    rotateCycleCalendarFeed(teamId: $teamId) {
      version
      url
      cycleCalendarFeed {
        id
        workspaceId
        teamId
        userId
        createdAt
        updatedAt
      }
    }
  }
`;

export interface CycleCalendarFeedResult {
  readonly url: string;
}

export async function ensureCycleCalendarFeed(teamId: string): Promise<CycleCalendarFeedResult> {
  const data = await gql<{
    ensureCycleCalendarFeed: { readonly url: string };
  }>(ENSURE_CYCLE_CALENDAR_FEED, { teamId });
  return { url: data.ensureCycleCalendarFeed.url };
}

export async function rotateCycleCalendarFeed(teamId: string): Promise<CycleCalendarFeedResult> {
  const data = await gql<{
    rotateCycleCalendarFeed: { readonly url: string };
  }>(ROTATE_CYCLE_CALENDAR_FEED, { teamId });
  return { url: data.rotateCycleCalendarFeed.url };
}

export function googleCalendarSubscribeURL(feedURL: string): string {
  const webcal = feedURL.replace(/^https:/i, 'webcal:').replace(/^http:/i, 'webcal:');
  return `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(webcal)}`;
}
