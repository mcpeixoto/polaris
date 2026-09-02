/**
 * The signed-in account's email, for a screen that has no replica to read it from.
 *
 * `useViewer` is the ordinary way to get this and it is not available here: it goes through
 * `useLiveQuery`, which needs the sync engine, and the consent screen renders outside the
 * shell precisely so that nothing of the workspace is on it. This is one query on a screen
 * that already makes one, and it is the only screen that needs it — a consent decision is the
 * one place where "as you" has to name which you.
 *
 * It never throws. An address that could not be read is a subtitle with one clause fewer, not
 * a consent screen that failed to render.
 */

import { VIEWER_QUERY } from '~/gql/operations';
import { gql } from '~/sync/api';

export async function loadViewerEmail(): Promise<string | null> {
  try {
    const data = await gql<{ viewer?: { user?: { email?: string | null } | null } | null }>(
      VIEWER_QUERY,
    );
    const email = data.viewer?.user?.email;
    return email === undefined || email === null || email === '' ? null : email;
  } catch {
    return null;
  }
}
